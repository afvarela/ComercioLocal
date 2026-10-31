"""Agente local de impresión RAW para Windows. Escucha únicamente en 127.0.0.1."""
import base64, ctypes, json, os, struct, traceback
from ctypes import wintypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

spool=ctypes.WinDLL('winspool.drv')
class DOC_INFO_1(ctypes.Structure):
    _fields_=[('pDocName',wintypes.LPWSTR),('pOutputFile',wintypes.LPWSTR),('pDatatype',wintypes.LPWSTR)]
def printers():
    needed=wintypes.DWORD(); returned=wintypes.DWORD(); flags=2|4
    spool.EnumPrintersW(flags,None,4,None,0,ctypes.byref(needed),ctypes.byref(returned))
    buf=(ctypes.c_byte*needed.value)();
    if not spool.EnumPrintersW(flags,None,4,buf,needed,ctypes.byref(needed),ctypes.byref(returned)): raise ctypes.WinError()
    class INFO(ctypes.Structure): _fields_=[('pPrinterName',wintypes.LPWSTR),('pServerName',wintypes.LPWSTR),('Attributes',wintypes.DWORD)]
    return sorted({ctypes.cast(buf,ctypes.POINTER(INFO))[i].pPrinterName for i in range(returned.value)})
def print_raw(name,text):
    require=name in printers()
    if not require: raise ValueError('La impresora seleccionada ya no está disponible')
    handle=wintypes.HANDLE()
    if not spool.OpenPrinterW(name,ctypes.byref(handle),None): raise ctypes.WinError()
    try:
        info=DOC_INFO_1('Comercio Local',None,'RAW')
        if not spool.StartDocPrinterW(handle,1,ctypes.byref(info)): raise ctypes.WinError()
        try:
            spool.StartPagePrinter(handle); data=text.replace('\n','\r\n').encode('cp850','replace')+b'\r\n\r\n\x1dV\x00'; written=wintypes.DWORD()
            if not spool.WritePrinter(handle,data,len(data),ctypes.byref(written)) or written.value!=len(data): raise ctypes.WinError()
            spool.EndPagePrinter(handle)
        finally: spool.EndDocPrinter(handle)
    finally: spool.ClosePrinter(handle)

class DOCINFOW(ctypes.Structure):
    _fields_=[('cbSize',ctypes.c_int),('lpszDocName',wintypes.LPCWSTR),('lpszOutput',wintypes.LPCWSTR),('lpszDatatype',wintypes.LPCWSTR),('fwType',wintypes.DWORD)]

def print_driver(name,text,font_size=9,margin_mm=1.5,right_margin_mm=0):
    """Imprime mediante el controlador de Windows, compatible con POS, USB y tinta."""
    if name not in printers(): raise ValueError('La impresora seleccionada ya no está disponible')
    gdi=ctypes.WinDLL('gdi32',use_last_error=True)
    gdi.CreateDCW.argtypes=[wintypes.LPCWSTR,wintypes.LPCWSTR,wintypes.LPCWSTR,ctypes.c_void_p]; gdi.CreateDCW.restype=wintypes.HDC
    gdi.StartDocW.argtypes=[wintypes.HDC,ctypes.POINTER(DOCINFOW)]; gdi.StartDocW.restype=ctypes.c_int
    for fn in ('StartPage','EndPage','EndDoc','AbortDoc'):
        getattr(gdi,fn).argtypes=[wintypes.HDC]; getattr(gdi,fn).restype=ctypes.c_int
    gdi.GetDeviceCaps.argtypes=[wintypes.HDC,ctypes.c_int]; gdi.GetDeviceCaps.restype=ctypes.c_int
    gdi.CreateFontW.argtypes=[ctypes.c_int]*13+[wintypes.LPCWSTR]; gdi.CreateFontW.restype=wintypes.HANDLE
    gdi.SelectObject.argtypes=[wintypes.HDC,wintypes.HANDLE]; gdi.SelectObject.restype=wintypes.HANDLE
    gdi.SetTextAlign.argtypes=[wintypes.HDC,wintypes.UINT]; gdi.SetTextAlign.restype=wintypes.UINT
    gdi.TextOutW.argtypes=[wintypes.HDC,ctypes.c_int,ctypes.c_int,wintypes.LPCWSTR,ctypes.c_int]
    gdi.DeleteObject.argtypes=[wintypes.HANDLE]; gdi.DeleteDC.argtypes=[wintypes.HDC]
    hdc=gdi.CreateDCW('WINSPOOL',name,None,None)
    if not hdc: raise ctypes.WinError(ctypes.get_last_error())
    doc=DOCINFOW(ctypes.sizeof(DOCINFOW),'Comercio Local',None,None,0)
    started=False; page=False; fonts=[]; previous=None
    try:
        if gdi.StartDocW(hdc,ctypes.byref(doc))<=0: raise ctypes.WinError(ctypes.get_last_error())
        started=True
        if gdi.StartPage(hdc)<=0: raise ctypes.WinError(ctypes.get_last_error())
        page=True
        font_size=max(6,min(12,float(font_size)));margin_mm=max(0,min(5,float(margin_mm)));right_margin_mm=max(0,min(10,float(right_margin_mm)));dpi=max(96,gdi.GetDeviceCaps(hdc,90)); height=-round(font_size*dpi/72)
        regular=gdi.CreateFontW(height,0,0,0,400,0,0,0,0,0,0,0,0x30,'Consolas')
        bold=gdi.CreateFontW(height,0,0,0,700,0,0,0,0,0,0,0,0x30,'Consolas')
        large=gdi.CreateFontW(-round((font_size+5)*dpi/72),0,0,0,700,0,0,0,0,0,0,0,0x30,'Consolas')
        fonts=[x for x in (regular,bold,large) if x]
        if regular: previous=gdi.SelectObject(hdc,regular)
        line_height=max(16,round((font_size+5)*dpi/72)); large_height=max(line_height,round((font_size+10)*dpi/72)); y=line_height
        bottom=max(400,gdi.GetDeviceCaps(hdc,10)-line_height); printable=max(1,gdi.GetDeviceCaps(hdc,8)-round(right_margin_mm*dpi/25.4)); margin=max(0,round(margin_mm*dpi/25.4))
        print_lines=text.replace('\r','').split('\n')+['','']
        for index,raw_line in enumerate(print_lines):
            if y+line_height>bottom:
                if not any(line.strip() for line in print_lines[index:]): break
                gdi.EndPage(hdc); page=False
                if gdi.StartPage(hdc)<=0: raise ctypes.WinError(ctypes.get_last_error())
                page=True; y=line_height
            centered=False; selected=regular; current_height=line_height; line=raw_line
            if line.startswith('[[CENTER_BOLD_LARGE]]'): line=line.removeprefix('[[CENTER_BOLD_LARGE]]');centered=True;selected=large;current_height=large_height
            elif line.startswith('[[CENTER_BOLD]]'): line=line.removeprefix('[[CENTER_BOLD]]');centered=True;selected=bold
            elif line.startswith('[[CENTER]]'): line=line.removeprefix('[[CENTER]]');centered=True
            elif line.startswith('[[BOLD]]'): line=line.removeprefix('[[BOLD]]');selected=bold
            if selected: gdi.SelectObject(hdc,selected)
            gdi.SetTextAlign(hdc,6 if centered else 0)
            x=printable//2 if centered else margin
            line=line.expandtabs(4)
            if line and not gdi.TextOutW(hdc,x,y,line,len(line)): raise ctypes.WinError(ctypes.get_last_error())
            y+=current_height
        gdi.EndPage(hdc); page=False
        if gdi.EndDoc(hdc)<=0: raise ctypes.WinError(ctypes.get_last_error())
        started=False
    except Exception:
        if started: gdi.AbortDoc(hdc)
        raise
    finally:
        if page: gdi.EndPage(hdc)
        if previous: gdi.SelectObject(hdc,previous)
        for font in fonts: gdi.DeleteObject(font)
        gdi.DeleteDC(hdc)

def print_label_bitmaps(name,pages):
    """Print browser-rendered labels silently through the selected Windows driver."""
    if name not in printers(): raise ValueError('La impresora seleccionada ya no está disponible')
    if not pages or len(pages)>500: raise ValueError('Cantidad de etiquetas inválida')
    gdi=ctypes.WinDLL('gdi32',use_last_error=True);gdi.CreateDCW.argtypes=[wintypes.LPCWSTR,wintypes.LPCWSTR,wintypes.LPCWSTR,ctypes.c_void_p];gdi.CreateDCW.restype=wintypes.HDC
    for fn in ('StartPage','EndPage','EndDoc','AbortDoc'):getattr(gdi,fn).argtypes=[wintypes.HDC];getattr(gdi,fn).restype=ctypes.c_int
    gdi.StartDocW.argtypes=[wintypes.HDC,ctypes.POINTER(DOCINFOW)];gdi.StartDocW.restype=ctypes.c_int;gdi.GetDeviceCaps.argtypes=[wintypes.HDC,ctypes.c_int];gdi.GetDeviceCaps.restype=ctypes.c_int;gdi.DeleteDC.argtypes=[wintypes.HDC]
    hdc=gdi.CreateDCW('WINSPOOL',name,None,None)
    if not hdc: raise ctypes.WinError(ctypes.get_last_error())
    gdi.StretchDIBits.argtypes=[wintypes.HDC,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_void_p,ctypes.c_void_p,wintypes.UINT,wintypes.DWORD]
    doc=DOCINFOW(ctypes.sizeof(DOCINFOW),'Etiquetas Comercio Local',None,None,0);started=False
    try:
        if gdi.StartDocW(hdc,ctypes.byref(doc))<=0: raise ctypes.WinError(ctypes.get_last_error())
        started=True;printable_w=gdi.GetDeviceCaps(hdc,8);printable_h=gdi.GetDeviceCaps(hdc,10)
        page_started=False;y_offset=0
        for page in pages:
            width=int(page['width']);height=int(page['height']);gray=base64.b64decode(page['pixels'],validate=True)
            if width<1 or height<1 or width*height!=len(gray) or width*height>4000000: raise ValueError('Imagen de etiqueta inválida')
            stride=((width*3+3)//4)*4;dib=bytearray(stride*height)
            for y in range(height):
                source=y*width;target=(height-1-y)*stride
                for x in range(width):
                    value=gray[source+x];offset=target+x*3;dib[offset:offset+3]=bytes((value,value,value))
            header=struct.pack('<IiiHHIIiiII',40,width,height,1,24,0,len(dib),0,0,0,0);info=ctypes.create_string_buffer(header);bits=(ctypes.c_ubyte*len(dib)).from_buffer(dib)
            target_w=printable_w;target_h=min(printable_h,round(height*target_w/width))
            if not page_started or (y_offset and y_offset+target_h>printable_h):
                if page_started:gdi.EndPage(hdc)
                if gdi.StartPage(hdc)<=0: raise ctypes.WinError(ctypes.get_last_error())
                page_started=True;y_offset=0
            result=gdi.StretchDIBits(hdc,0,y_offset,target_w,target_h,0,0,width,height,bits,info,0,0x00CC0020)
            if result in (0,-1): raise ctypes.WinError(ctypes.get_last_error())
            y_offset+=target_h
        if page_started:gdi.EndPage(hdc)
        if gdi.EndDoc(hdc)<=0: raise ctypes.WinError(ctypes.get_last_error())
        started=False
    except Exception:
        if started:gdi.AbortDoc(hdc)
        raise
    finally:gdi.DeleteDC(hdc)
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*_): pass
    def headers_ok(self):
        origin=self.headers.get('Origin',''); return origin.startswith('http://127.0.0.1:') or origin.startswith('https://comercio-local')
    def reply(self,status,payload):
        body=json.dumps(payload,ensure_ascii=False).encode(); self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(body))); self.send_header('Access-Control-Allow-Origin',self.headers.get('Origin','null')); self.send_header('Access-Control-Allow-Private-Network','true'); self.send_header('Vary','Origin'); self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self):
        if not self.headers_ok(): return self.reply(403,{'error':'Origen no autorizado'})
        self.send_response(204); self.send_header('Access-Control-Allow-Origin',self.headers['Origin']); self.send_header('Access-Control-Allow-Headers','Content-Type'); self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS'); self.send_header('Access-Control-Allow-Private-Network','true'); self.end_headers()
    def do_GET(self):
        try:
            if not self.headers_ok() or self.path!='/printers': raise ValueError('Solicitud no autorizada')
            self.reply(200,{'printers':printers()})
        except Exception as e: self.reply(400,{'error':str(e)})
    def do_POST(self):
        try:
            if not self.headers_ok() or self.path not in ('/print','/print-labels'): raise ValueError('Solicitud no autorizada')
            n=int(self.headers.get('Content-Length','0')); data=json.loads(self.rfile.read(n)); text=str(data.get('text',''))
            if self.path=='/print-labels':
                print_label_bitmaps(str(data.get('printer','')),data.get('pages',[]));return self.reply(200,{'ok':True,'mode':'labels-driver'})
            if not text or len(text)>100000: raise ValueError('Documento vacío o demasiado grande')
            mode=str(data.get('mode','driver'))
            if mode=='raw':print_raw(str(data.get('printer','')),text)
            else:print_driver(str(data.get('printer','')),text,data.get('font_size',9),data.get('margin_mm',1.5),data.get('right_margin_mm',0))
            self.reply(200,{'ok':True,'mode':mode})
        except Exception as e:
            print(traceback.format_exc(),flush=True); self.reply(400,{'error':str(e) or type(e).__name__})
if __name__=='__main__':
    port=int(os.getenv('COMERCIO_PRINTER_PORT','8768'))
    print(f'Agente de impresora: http://127.0.0.1:{port}',flush=True); ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()
