"""Untrusted document decoding, invoked in a networkless, read-only bwrap sandbox."""
import sys, json, base64, io, pathlib, zipfile, resource
resource.setrlimit(resource.RLIMIT_AS, (1536*1024**2,1536*1024**2))
resource.setrlimit(resource.RLIMIT_CPU, (100,100))
from PIL import Image, ImageOps
Image.MAX_IMAGE_PIXELS=25000000

def image_data(image):
    image=ImageOps.exif_transpose(image).convert('RGB')
    image.thumbnail((2400,2400))
    out=io.BytesIO(); image.save(out,'JPEG',quality=88)
    return base64.b64encode(out.getvalue()).decode()
def emit(value):
    print(json.dumps(value,ensure_ascii=False),flush=True)
f=pathlib.Path(sys.argv[1]); ext=f.suffix.lower()
if f.stat().st_size>128*1024**2: raise ValueError('文件超过 128 MB，请拆分后重试')
if ext=='.pdf':
    import fitz
    doc=fitz.open(f)
    if doc.is_encrypted: raise ValueError('PDF 已加密，请提供解密文件')
    if len(doc)>200: raise ValueError('文件超过 200 页，请拆分后重试')
    emit({'total':len(doc)})
    for i,p in enumerate(doc):
        text=p.get_text('text').strip()
        # A page containing a substantial raster may mix selectable text and scans.
        raster=any((r.width*r.height)/(p.rect.width*p.rect.height)>0.12 for im in p.get_images() for r in p.get_image_rects(im[0]))
        if len(text)>=30 and not raster: emit({'page':i+1,'text':text,'kind':'text'})
        else:
            scale=min(2,2400/max(p.rect.width,p.rect.height))
            pix=p.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False)
            emit({'page':i+1,'image':image_data(Image.open(io.BytesIO(pix.tobytes('png')))),'kind':'recognition'})
elif ext in ['.png','.jpg','.jpeg','.webp','.bmp','.tif','.tiff']:
    im=Image.open(f); count=getattr(im,'n_frames',1)
    if count>200: raise ValueError('图片超过 200 页')
    emit({'total':count})
    for i in range(count):
        im.seek(i);emit({'page':i+1,'image':image_data(im),'kind':'recognition'})
elif ext in ['.docx']:
    from xml.etree import ElementTree as ET
    ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    with zipfile.ZipFile(f) as z:
        entry=z.getinfo('word/document.xml')
        if entry.file_size>32*1024**2: raise ValueError('Word 正文过大')
        root=ET.fromstring(z.read(entry))
        text='\n'.join(''.join(t.text or '' for t in p.findall('.//w:t',ns)) for p in root.findall('.//w:p',ns))
        images=[x for x in z.infolist() if x.filename.startswith('word/media/')]
        if len(images)>199: raise ValueError('Word 图片过多，请拆分')
        emit({'total':1+len(images)})
        emit({'page':1,'text':text,'kind':'text','location':'Word 正文（逻辑段落，非印刷页码）'})
        for i,x in enumerate(images):
            if x.file_size>32*1024**2: raise ValueError('Word 图片过大')
            emit({'page':i+2,'image':image_data(Image.open(io.BytesIO(z.read(x)))),'kind':'recognition','location':'Word 内嵌图片 '+str(i+1)+'（非印刷页码）'})
elif ext in ['.txt','.md','.csv']:
    raw=f.read_bytes()
    if len(raw)>8*1024**2: raise ValueError('文本过大，请拆分')
    try:text=raw.decode('utf-8-sig')
    except UnicodeDecodeError:text=raw.decode('gb18030')
    emit({'total':1});emit({'page':1,'text':text,'kind':'text','location':'文本逻辑段落'})
else: raise ValueError('此格式尚不支持自动解析，请转换为 PDF、Word、图片或文本')
