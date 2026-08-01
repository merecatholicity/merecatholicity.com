#!/usr/bin/env python3
"""wf_pd_measure.py — computed-style capture for the forum profile/DM surface.
Same mechanism as wf_measure.py but with a profile/dm fixture + selector set.
Usage: python3 wf_pd_measure.py <css_path> <width> <theme> <out.json>
"""
import json, os, signal, subprocess, sys, time, urllib.request, http.server, socketserver, threading

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(REPO, 'docs')
CHROME_DIR = os.path.expanduser('~/.cloakbrowser/chromium-146.0.7680.177.5')
FIXTURE = open(os.path.join(REPO, 'scratchpad/wf_pd_fixture.html')).read()

BASE = ['position','top','left','right','bottom','zIndex','height','width','minWidth','flexShrink','flexGrow','flexBasis',
        'display','flexDirection','alignItems','justifyContent','gap','textAlign','objectFit','overflow',
        'paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginBottom','marginLeft','marginRight',
        'backgroundColor','color','fontStyle','whiteSpace','overflowWrap',
        'fontSize','fontWeight','lineHeight','letterSpacing','textTransform','textDecorationLine',
        'borderTopWidth','borderTopColor','borderTopStyle','borderBottomWidth','borderBottomColor',
        'borderLeftWidth','borderRightWidth',
        'borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius','fontFamily']

SELECTORS = [
 '.profile-head','.profile-avatar','.profile-avatar img','.profile-names','.profile-name',
 '.profile-assigned','.profile-faith','.profile-rank','.profile-empty','.profile-bio',
 'label.profile-label','h3.profile-label','.profile-avatar-empty-probe',
 '.dm-search','.dm-search input','.dm-suggest','.dm-thread .dm-msg:first-child','.dm-mine',
 '.dm-thread .dm-msg:last-child','.dm-msg .comment-body',
]
PSEUDO = [
 ('.profile-avatar-empty-probe','::before'),
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
    port = 9800 + (width % 100)
    drv = subprocess.Popen([os.path.join(CHROME_DIR,'chromedriver'), '--port=%d'%port],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    args = ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
            '--window-size=%d,900'%width, '--user-data-dir=/tmp/wfpd-%d-%d'%(port,int(time.time()))]
    sid = wd(port,'POST','/session',{'capabilities':{'alwaysMatch':{
        'goog:chromeOptions':{'binary':os.path.join(CHROME_DIR,'chrome'),'args':args}}}})['value']['sessionId']
    try:
        wd(port,'POST','/session/%s/url'%sid, {'url':'http://127.0.0.1:%d/community.html?app=0'%sport})
        time.sleep(1.2)
        inject = """
          var css=arguments[0], theme=arguments[1], fx=arguments[2];
          document.querySelectorAll('link[rel=stylesheet]').forEach(function(l){ l.remove(); });
          document.querySelectorAll('mc-appbar,mc-tabbar,mc-sheet,mc-deskbar,mc-sidebar,mc-footer,mc-home,mc-settings').forEach(function(e){e.remove();});
          var s=document.getElementById('wf-css'); if(s) s.remove();
          s=document.createElement('style'); s.id='wf-css'; s.textContent=css; document.head.appendChild(s);
          document.documentElement.setAttribute('data-theme', theme==='dark'?'dark':'light');
          if(theme!=='dark') document.documentElement.removeAttribute('data-dark');
          var host=document.getElementById('wf-host'); if(host) host.remove();
          host=document.createElement('div'); host.id='wf-host'; host.innerHTML=fx; document.body.appendChild(host);
          return document.querySelectorAll('#wf-host .profile-head').length;
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
            res[pair[0]+pair[1]]={content:cs.content, fontSize:cs.fontSize, opacity:cs.opacity};
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
