import numpy as np, sys
from PIL import Image
D=sys.argv[1]; W=int(sys.argv[2]); H=W//2
NS=512; T=64; ORD_NS=8  # order 3 tiles (nside 8), 64 px each -> nside 512
def tiles(k):
    a=np.asarray(Image.open(f"{D}/a{k}.png").convert("RGBA")).astype(np.float32)
    return a[...,0], a[...,3]
def ang2xyf(theta,phi):
    z=np.cos(theta); za=np.abs(z); tt=np.mod(phi,2*np.pi)/(np.pi/2)
    face=np.zeros(z.shape,int); ix=np.zeros(z.shape,int); iy=np.zeros(z.shape,int)
    eq=za<=2/3
    t1=NS*(0.5+tt[eq]); t2=NS*z[eq]*0.75
    jp=(t1-t2).astype(int); jm=(t1+t2).astype(int)
    ifp=jp//NS; ifm=jm//NS
    f=np.where(ifp==ifm,ifp|4,np.where(ifp<ifm,ifp,ifm+8))
    face[eq]=f; ix[eq]=jm&(NS-1); iy[eq]=NS-(jp&(NS-1))-1
    po=~eq
    ntt=np.minimum(tt[po].astype(int),3); tp=tt[po]-ntt; tmp=NS*np.sqrt(3*(1-za[po]))
    jp=np.minimum((tp*tmp).astype(int),NS-1); jm=np.minimum(((1-tp)*tmp).astype(int),NS-1)
    north=z[po]>=0
    face[po]=np.where(north,ntt,ntt+8); ix[po]=np.where(north,NS-jm-1,jp); iy[po]=np.where(north,NS-jp-1,jm)
    return face,ix,iy
def interleave(x,y):
    r=np.zeros(x.shape,int)
    for b in range(4): r|=((x>>b)&1)<<(2*b) | ((y>>b)&1)<<(2*b+1)
    return r
# Mollweide grid, galactic, l=0 centre, l increasing leftwards
xs=(np.arange(W)+0.5)/W*2-1; ys=1-(np.arange(H)+0.5)/H*2
X,Y=np.meshgrid(xs*2*np.sqrt(2),ys*np.sqrt(2))
inside=(X/(2*np.sqrt(2)))**2+(Y/np.sqrt(2))**2<=1
th=np.arcsin(np.clip(Y/np.sqrt(2),-1,1))
b=np.arcsin(np.clip((2*th+np.sin(2*th))/np.pi,-1,1))
l=-np.pi*X/(2*np.sqrt(2)*np.cos(th)+1e-12)
g=np.stack([np.cos(b)*np.cos(l),np.cos(b)*np.sin(l),np.sin(b)])
A=np.array([[-0.0548755604162154,-0.8734370902348850,-0.4838350155487132],[0.4941094278755837,-0.4448296299600112,0.7469822444972189],[-0.8676661490190047,-0.1980763734312015,0.4559837761750669]])
e=np.tensordot(A.T,g,1)
dec=np.arcsin(np.clip(e[2],-1,1)); ra=np.arctan2(e[1],e[0])
face,ix,iy=ang2xyf(np.pi/2-dec,np.mod(ra,2*np.pi))
tx,ty=ix>>6,iy>>6; u,v=ix&63,iy&63
npix=face*64+interleave(tx,ty)
col0=(npix%27)*T; row0=(npix//27)*T
mode=int(sys.argv[3]) if len(sys.argv)>3 else 0
def lookup(img,alpha):
    # HiPS tile orientation variants
    cu,cv={0:(u,T-1-v),1:(v,T-1-u),2:(u,v),3:(v,u),4:(T-1-u,v),5:(T-1-v,u),6:(T-1-u,T-1-v),7:(T-1-v,T-1-u)}[mode]
    return img[row0+cv,col0+cu], alpha[row0+cv,col0+cu]
ch=[]
for k in (87,46,12):
    im,al=tiles(k); c,a=lookup(im,al); c=np.where(inside&(a>0),c,np.nan); ch.append(c)
rgb=np.stack(ch,-1)
# smoothness metric for orientation test
d=np.nanmean(np.abs(np.diff(rgb[...,1],axis=1)))
print("mode",mode,"roughness",round(float(d),3))
if len(sys.argv)>4:
    def doldur(c):
        for _ in range(12):
            m=np.isnan(c)&inside
            if not m.any(): break
            P=np.pad(c,2,constant_values=np.nan); acc=np.zeros_like(c); n=np.zeros_like(c)
            for dy in range(5):
                for dx in range(5):
                    w=P[dy:dy+H,dx:dx+W]; ok=~np.isnan(w); acc+=np.where(ok,w,0); n+=ok
            c=np.where(m&(n>0),acc/np.maximum(n,1),c)
        return c
    out=np.zeros((H,W,4),np.uint8)
    for i in range(3):
        c=doldur(rgb[...,i]); bg,hi=np.nanpercentile(c[inside],[30,99.95])
        c=np.clip((c-bg)/(hi-bg),0,None); c=np.arcsinh(c*4)/np.arcsinh(4)*0.92; c=np.clip(c,0,1)
        out[...,i]=np.nan_to_num(c*255).astype(np.uint8)
    out[...,3]=np.where(inside,255,0)
    Image.fromarray(out,"RGBA").save(sys.argv[4],quality=int(sys.argv[5]) if len(sys.argv)>5 else 80,method=6)
