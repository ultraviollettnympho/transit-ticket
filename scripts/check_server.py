#!/usr/bin/env python3
import http.client, json, os, sys
host='localhost'
port=8000

def head_root():
    print('--- HTTP HEAD for / ---')
    try:
        conn=http.client.HTTPConnection(host,port,timeout=5)
        conn.request('HEAD','/')
        r=conn.getresponse()
        print(r.status, r.reason)
        for k,v in r.getheaders():
            if k.lower() in ('content-type','content-length','last-modified'):
                print(f'{k}: {v}')
        conn.close()
    except Exception as e:
        print('HEAD failed:', e)


def check_manifest():
    print('\n--- manifest.json parse check ---')
    try:
        conn=http.client.HTTPConnection(host,port,timeout=5)
        conn.request('GET','/manifest.json')
        r=conn.getresponse()
        data=r.read()
        manifest=json.loads(data.decode('utf-8'))
        print('manifest keys:', ', '.join(manifest.keys()))
        print('name:', manifest.get('name'))
    except Exception as e:
        print('manifest check failed:', e)


def preview_sw():
    print('\n--- service-worker.js head ---')
    try:
        conn=http.client.HTTPConnection(host,port,timeout=5)
        conn.request('GET','/service-worker.js')
        r=conn.getresponse()
        data=r.read(4096).decode('utf-8', errors='ignore')
        for i,line in enumerate(data.splitlines()[:40]):
            print(line)
        conn.close()
    except Exception as e:
        print('service-worker fetch failed:', e)


def list_icons():
    print('\n--- icons list ---')
    try:
        for fn in sorted(os.listdir('icons')):
            st=os.stat(os.path.join('icons',fn))
            print(fn, st.st_size)
    except Exception as e:
        print('icons list failed:', e)

if __name__=='__main__':
    head_root()
    check_manifest()
    preview_sw()
    list_icons()
