#!/usr/bin/env python3
"""wf_measure.py — capture computed styles of app-chrome elements from a synthetic
fixture under a given built-CSS file, at a viewport width + theme. Serves docs/,
loads a page (for a realistic root + tokens), injects the built CSS as <style>,
removes the live chrome, appends the fixture, then reads getComputedStyle for a
probe list (base props + selected pseudo-elements/states).

Usage: python3 wf_measure.py <css_path> <width> <theme> <out.json>
"""
import json, os, signal, subprocess, sys, time, urllib.request, http.server, socketserver, threading

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(REPO, 'docs')
CHROME_DIR = os.path.expanduser('~/.cloakbrowser/chromium-146.0.7680.177.5')
FIXTURE = open(os.path.join(REPO, 'scratchpad/wf_fixture.html')).read()

BASE = ['position','top','left','right','bottom','zIndex','height','width','minWidth','maxWidth','minHeight',
        'display','flexGrow','flexDirection','alignItems','alignSelf','justifyContent','gap','flexBasis',
        'paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginBottom','marginLeft','marginRight',
        'backgroundColor','backgroundImage','color','opacity','visibility','cursor','textAlign','textDecorationLine',
        'fontSize','fontWeight','lineHeight','letterSpacing','textTransform','whiteSpace','overflow','overflowY','textOverflow',
        'borderTopWidth','borderTopColor','borderTopStyle','borderBottomWidth','borderBottomColor','borderBottomStyle',
        'borderLeftWidth','borderLeftColor','borderRightWidth','borderRightColor',
        'borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius',
        'boxShadow','transitionProperty','transitionDuration','transform','fontFamily','appearance']

SELECTORS = [
 '.mc-appbar','.mc-appbar-side','.mc-appbar-r','.mc-appbar-title','.mc-ab-btn','.mc-ab-brand',
 '.mc-tabbar','.mc-tab','.mc-tab-ico','.mc-tab-lbl','.mc-tab.mc-tab-on','.mc-tab.mc-tab-on .mc-tab-ico',
 '.mc-tab-hero .mc-tab-ico','.mc-tab-hero .mc-tab-lbl','.mc-tab-badge',
 '.mc-sheet-scrim','.mc-sheet-scrim.on','.mc-sheet','.mc-sheet.on','.mc-sheet-grip','.mc-sheet-head',
 '.mc-set-sec','.mc-set-row','.mc-set-row.mc-set-danger','.mc-set-go','.mc-set-key','.mc-set-keyin','.mc-set-copy',
 '.mc-set-switch','.mc-set-switch.on','.mc-set-knob','.mc-set-switch.on .mc-set-knob',
 '.mc-set-palette','.mc-set-pal','.mc-set-pal.on','.mc-pal-sw','.mc-pal-charcoal .mc-pal-sw','.mc-pal-slate .mc-pal-sw','.mc-pal-ink .mc-pal-sw',
 '.mc-home','.mc-home-hero','.mc-home-cross','.mc-home-feats','.mc-home-feat','.mc-home-feat-ico','.mc-home-feat-txt',
 '.mc-home-feat-txt strong','.mc-home-feat-txt small','.mc-home-go','.mc-home-sec','.mc-home-shelf','.mc-home-row',
 '.mc-home-row-txt','.mc-home-row-txt strong','.mc-home-row-txt small','.mc-home-settings',
 '.mc-selbtn','.mc-selbtn-caret','.mc-optlist','.mc-optrow','.mc-optrow.on',
 '.mc-confirm-msg','.mc-confirm-row','.mc-confirm-btn','.mc-confirm-cancel','.mc-confirm-ok.mc-confirm-danger','.mc-toast','.mc-toast.on',
 '.mc-deskbar','.mc-db-hist','.mc-db-brand','.mc-db-word','.mc-db-search','.mc-db-searchico','.mc-db-search input',
 '.mc-db-cluster','.mc-db-ico','.mc-db-menu','.mc-db-join','.mc-db-acct',
 '.mc-sidebar','.mc-sb-toggle','.mc-sb-item','.mc-sb-item.mc-tab-on','.mc-sb-ico','.mc-sb-lbl','.mc-sidebar.mc-sb-wide .mc-sb-lbl','.mc-sb-item .mc-tab-badge',
 '.mc-footer','.mc-foot-sep',
]
PSEUDO = [
 ('.mc-optrow.on','::after'),
 ('.mc-tab-badge','::before'),  # none; sanity
 ('.mc-selbtn','::after'),
]

def wd(port, m, p, b=None):
    d = json.dumps(b).encode() if b is not None else None
    req = urllib.request.Request('http://127.0.0.1:%d%s' % (port, p), data=d, method=m,
                                 headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

def main():
    css_path, width, theme, out = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
    css_text = open(css_path).read()
    os.chdir(DOCS)
    httpd = socketserver.TCPServer(('127.0.0.1', 0), http.server.SimpleHTTPRequestHandler)
    sport = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    port = 9700 + (width % 100)
    drv = subprocess.Popen([os.path.join(CHROME_DIR,'chromedriver'), '--port=%d'%port],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    args = ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
            '--window-size=%d,900'%width, '--user-data-dir=/tmp/wf-%d-%d'%(port,int(time.time()))]
    sid = wd(port,'POST','/session',{'capabilities':{'alwaysMatch':{
        'goog:chromeOptions':{'binary':os.path.join(CHROME_DIR,'chrome'),'args':args}}}})['value']['sessionId']
    try:
        wd(port,'POST','/session/%s/url'%sid, {'url':'http://127.0.0.1:%d/community.html?app=0'%sport})
        time.sleep(1.5)
        inject = """
          var css=arguments[0], theme=arguments[1], fx=arguments[2];
          document.querySelectorAll('link[rel=stylesheet]').forEach(function(l){ l.remove(); });
          document.querySelectorAll('mc-appbar,mc-tabbar,mc-sheet,mc-deskbar,mc-sidebar,mc-footer,mc-home,mc-settings').forEach(function(e){e.remove();});
          var s=document.getElementById('wf-css'); if(s) s.remove();
          s=document.createElement('style'); s.id='wf-css'; s.textContent=css; document.head.appendChild(s);
          document.documentElement.setAttribute('data-theme', theme==='dark'?'dark':'light');
          if(theme==='dark'){ if(theme.length){} }
          if(theme!=='dark') document.documentElement.removeAttribute('data-dark');
          var host=document.getElementById('wf-host'); if(host) host.remove();
          host=document.createElement('div'); host.id='wf-host'; host.innerHTML=fx; document.body.appendChild(host);
          return document.querySelectorAll('#wf-host .mc-footer').length;
        """
        wd(port,'POST','/session/%s/execute/sync'%sid, {'script':inject, 'args':[css_text, theme, FIXTURE]})
        time.sleep(0.4)
        probe = """
          var sels=arguments[0], props=arguments[1], pseudo=arguments[2];
          var res={};
          sels.forEach(function(sel){
            var el=document.querySelector('#wf-host '+sel);
            if(!el){ res[sel]=null; return; }
            var cs=getComputedStyle(el); var o={};
            props.forEach(function(p){ o[p]=cs[p]; });
            res[sel]=o;
          });
          pseudo.forEach(function(pair){
            var el=document.querySelector('#wf-host '+pair[0]);
            if(!el){ res[pair[0]+pair[1]]=null; return; }
            var cs=getComputedStyle(el, pair[1]);
            res[pair[0]+pair[1]]={content:cs.content, color:cs.color, position:cs.position, right:cs.right, fontSize:cs.fontSize, transform:cs.transform};
          });
          return res;
        """
        res = wd(port,'POST','/session/%s/execute/sync'%sid, {'script':probe, 'args':[SELECTORS, BASE, PSEUDO]})['value']
        json.dump(res, open(out,'w'), indent=1, sort_keys=True)
        nmiss=[k for k,v in res.items() if v is None]
        print('wrote', out, '| null:', nmiss)
    finally:
        try: wd(port,'DELETE','/session/%s'%sid)
        except Exception: pass
        drv.send_signal(signal.SIGTERM)
        httpd.shutdown()

if __name__ == '__main__':
    main()
