#!/usr/bin/env python3
"""wf_board_measure.py — capture computed styles of the FORUM-BOARD surface
(board-cat / board-topic / board-crumb / board-pages and friends) from a synthetic
fixture under a given built-CSS file, at a viewport width + theme.

Adapted from wf_measure.py. Serves docs/, loads community.html?app=0 (realistic root
+ tokens), strips all stylesheets + live chrome, injects the built CSS, appends the
board fixture, reads getComputedStyle for a probe list.

Usage: python3 wf_board_measure.py <css_path> <width> <theme> <out.json>
"""
import json, os, signal, subprocess, sys, time, urllib.request, http.server, socketserver, threading

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(REPO, 'docs')
CHROME_DIR = os.path.expanduser('~/.cloakbrowser/chromium-146.0.7680.177.5')
FIXTURE = open(os.path.join(REPO, 'scratchpad/wf_board_fixture.html')).read()

BASE = ['position','top','left','right','bottom','zIndex','height','width','minWidth','maxWidth','minHeight',
        'display','flexGrow','flexShrink','flexDirection','alignItems','alignSelf','justifyContent','gap','flexBasis','flexWrap',
        'paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginBottom','marginLeft','marginRight',
        'backgroundColor','backgroundImage','color','opacity','visibility','cursor','textAlign','textDecorationLine',
        'fontSize','fontWeight','lineHeight','letterSpacing','textTransform','whiteSpace','overflow','overflowY','textOverflow','overflowWrap',
        'borderTopWidth','borderTopColor','borderTopStyle','borderBottomWidth','borderBottomColor','borderBottomStyle',
        'borderLeftWidth','borderLeftColor','borderRightWidth','borderRightColor',
        'borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius',
        'boxShadow','transitionProperty','transitionDuration','transform','fontFamily']

# Each entry is a scoped selector resolving to exactly one node in the fixture.
SELECTORS = [
 '.board-crumb', '.board-crumb a',
 '.board-cats', '.board-cat', '.board-cat-admin',
 '.board-cat-name', '.board-cat-desc',
 '.board-stats', '.board-latest', '.board-latest a', '.board-stats a',
 '.mc-cardnav', '.board-cat.mc-cardnav',
 '.board-topics', '.board-topic', '.board-topic-left',
 '.board-topic-title', '.board-sticky',
 '.board-topic.mc-cardnav',
 '.topic-pages', '.topic-pages strong', '.topic-pages a',
 'section.board > .board-pages', 'section.board > .board-pages a', 'section.board > .board-pages strong',
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
    port = 9600 + (width % 100)
    drv = subprocess.Popen([os.path.join(CHROME_DIR,'chromedriver'), '--port=%d'%port],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    args = ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
            '--window-size=%d,900'%width, '--user-data-dir=/tmp/wfb-%d-%d'%(port,int(time.time()))]
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
          if(theme!=='dark') document.documentElement.removeAttribute('data-dark');
          var host=document.getElementById('wf-host'); if(host) host.remove();
          host=document.createElement('div'); host.id='wf-host'; host.innerHTML=fx; document.body.appendChild(host);
          return document.querySelectorAll('#wf-host .board-cat').length;
        """
        n = wd(port,'POST','/session/%s/execute/sync'%sid, {'script':inject, 'args':[css_text, theme, FIXTURE]})['value']
        time.sleep(0.4)
        probe = """
          var sels=arguments[0], props=arguments[1];
          var res={};
          sels.forEach(function(sel){
            var el=document.querySelector('#wf-host '+sel);
            if(!el){ res[sel]=null; return; }
            var cs=getComputedStyle(el); var o={};
            props.forEach(function(p){ o[p]=cs[p]; });
            var r=el.getBoundingClientRect(); o.__w=Math.round(r.width*100)/100; o.__h=Math.round(r.height*100)/100;
            res[sel]=o;
          });
          return res;
        """
        res = wd(port,'POST','/session/%s/execute/sync'%sid, {'script':probe, 'args':[SELECTORS, BASE]})['value']
        json.dump(res, open(out,'w'), indent=1, sort_keys=True)
        nmiss=[k for k,v in res.items() if v is None]
        print('wrote', out, '| board-cat count:', n, '| null:', nmiss)
    finally:
        try: wd(port,'DELETE','/session/%s'%sid)
        except Exception: pass
        drv.send_signal(signal.SIGTERM)
        httpd.shutdown()

if __name__ == '__main__':
    main()
