#!/usr/bin/env python3
"""Measure computed styles of the forum-post surface from a synthetic fixture
under a given built-CSS file at a viewport width + theme. Adapted from
wf_measure.py. Usage: python3 wf_forum_measure.py <css_path> <width> <theme> <out.json>"""
import json, os, signal, subprocess, sys, time, urllib.request, http.server, socketserver, threading

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(REPO, 'docs')
CHROME_DIR = os.path.expanduser('~/.cloakbrowser/chromium-146.0.7680.177.5')
FIXTURE = open(os.path.join(REPO, 'scratchpad/wf_forum_fixture.html')).read()

BASE = ['position','top','left','display','flexWrap','flexDirection','alignItems','justifyContent','gap',
        'paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginBottom','marginLeft','marginRight',
        'backgroundColor','color','opacity','visibility','cursor','textAlign','textDecorationLine',
        'fontSize','fontWeight','fontStyle','lineHeight','textTransform','whiteSpace','overflowWrap','verticalAlign',
        'width','height','objectFit',
        'borderTopWidth','borderTopColor','borderTopStyle','borderBottomWidth','borderBottomColor','borderBottomStyle',
        'borderLeftWidth','borderLeftColor','borderLeftStyle','borderRightWidth','borderRightColor',
        'borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius']

SELECTORS = [
 '.comment', '.comment-head', '.comment-author', '.comment-author-link', '.comment-author-sub',
 '.comment-avatar-link', '.comment-avatar', '.comment-faith', '.comment-date', '.comment-delete',
 '.comment-body', '.comment-body strong', '.comment-body em', '.comment-sig',
 '.md-toolbar', '.md-btn', '.md-btn.md-b', '.md-btn.md-i', '.comment-form .comment-text',
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
    port = 9820 + (width % 100)
    drv = subprocess.Popen([os.path.join(CHROME_DIR,'chromedriver'), '--port=%d'%port],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    args = ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
            '--window-size=%d,900'%width, '--user-data-dir=/tmp/wff-%d-%d'%(port,int(time.time()))]
    sid = wd(port,'POST','/session',{'capabilities':{'alwaysMatch':{
        'goog:chromeOptions':{'binary':os.path.join(CHROME_DIR,'chrome'),'args':args}}}})['value']['sessionId']
    try:
        wd(port,'POST','/session/%s/url'%sid, {'url':'http://127.0.0.1:%d/community.html?app=0'%sport})
        time.sleep(1.2)
        inject = """
          var css=arguments[0], theme=arguments[1], fx=arguments[2];
          document.querySelectorAll('link[rel=stylesheet]').forEach(function(l){ l.remove(); });
          var s=document.getElementById('wf-css'); if(s) s.remove();
          s=document.createElement('style'); s.id='wf-css'; s.textContent=css; document.head.appendChild(s);
          document.documentElement.setAttribute('data-theme', theme==='dark'?'dark':'light');
          if(theme!=='dark') document.documentElement.removeAttribute('data-dark');
          var host=document.getElementById('wf-host'); if(host) host.remove();
          host=document.createElement('div'); host.id='wf-host'; host.innerHTML=fx; document.body.appendChild(host);
          return document.querySelectorAll('#wf-host .comment').length;
        """
        n = wd(port,'POST','/session/%s/execute/sync'%sid, {'script':inject, 'args':[css_text, theme, FIXTURE]})['value']
        time.sleep(0.3)
        probe = """
          var sels=arguments[0], props=arguments[1];
          var res={};
          sels.forEach(function(sel){
            var el=document.querySelector('#wf-host '+sel);
            if(!el){ res[sel]=null; return; }
            var cs=getComputedStyle(el); var o={};
            props.forEach(function(p){ o[p]=cs[p]; });
            var r=el.getBoundingClientRect(); o['_w']=Math.round(r.width); o['_h']=Math.round(r.height);
            res[sel]=o;
          });
          return res;
        """
        res = wd(port,'POST','/session/%s/execute/sync'%sid, {'script':probe, 'args':[SELECTORS, BASE]})['value']
        json.dump(res, open(out,'w'), indent=1, sort_keys=True)
        nmiss=[k for k,v in res.items() if v is None]
        print('wrote', out, '| comments:', n, '| null:', nmiss)
    finally:
        try: wd(port,'DELETE','/session/%s'%sid)
        except Exception: pass
        drv.send_signal(signal.SIGTERM)
        httpd.shutdown()

if __name__ == '__main__':
    main()
