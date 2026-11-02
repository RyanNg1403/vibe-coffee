"""Eighteen visible Blender portrait treatments on two credited source anatomies.

The UV atlas is repainted per semantic mesh region, preserving source
facial detail, garment seams and hair strands. A single atlas per person keeps
runtime image cost bounded; geometry/material assignments remain editable.
"""
import bpy
import math
import numpy as np
from mathutils import Vector

# Colors are atlas RGB values, chosen as a coordinated everyday wardrobe.
PROFILES = [
 dict(name='Copper hair / ivory tee',hair='long',hair_color=(.43,.24,.12),shirt=(.76,.72,.64),pants=(.27,.32,.35),skin=(1,.98,.94)),
 dict(name='Cropped dark hair / navy overshirt',hair='crop',hair_color=(.10,.085,.075),shirt=(.21,.29,.39),pants=(.58,.52,.40),eyewear='angular',frame_color=(.075,.055,.035),skin=(.87,.79,.71)),
 dict(name='Raven curls / sage tee',hair='curls',hair_color=(.095,.08,.072),shirt=(.41,.48,.36),pants=(.19,.22,.23),eyewear='round',skin=(.74,.60,.49)),
 dict(name='Chestnut sweep / linen overshirt',hair='swept',hair_color=(.30,.19,.115),shirt=(.72,.69,.60),pants=(.30,.34,.27),skin=(1,.94,.87)),
 dict(name='Blonde half-up hair / terracotta tee',hair='half_up',hair_color=(.65,.49,.28),shirt=(.57,.30,.20),pants=(.31,.39,.47),hair_bun=True,skin=(1,.98,.94)),
 dict(name='Silver crop / charcoal overshirt',hair='crop',hair_color=(.55,.53,.49),shirt=(.23,.26,.27),pants=(.52,.47,.36),eyewear='round',frame_color=(.10,.07,.035),skin=(.92,.89,.83)),
 dict(name='Auburn curls / ochre tee',hair='curls',hair_color=(.42,.20,.10),shirt=(.64,.49,.25),pants=(.27,.34,.39),headwear='cap',hat_color=(.035,.065,.11),skin=(.93,.88,.81)),
 dict(name='Black crop / rust overshirt',hair='crop',hair_color=(.08,.07,.062),shirt=(.54,.28,.19),pants=(.18,.23,.27),skin=(.68,.53,.43)),
 dict(name='Dark half-up hair / indigo tee',hair='half_up',hair_color=(.12,.09,.07),shirt=(.24,.30,.43),pants=(.58,.50,.38),hair_bun=True,eyewear='round',skin=(.83,.72,.61)),
 dict(name='Chestnut / sage overshirt and wine knit',hair='crop',hair_color=(.24,.15,.09),shirt=(.39,.47,.36),pants=(.20,.22,.22),headwear='beanie',hat_color=(.16,.035,.055),skin=(1,.95,.89)),
 dict(name='Silver curls / plum tee',hair='curls',hair_color=(.58,.57,.53),shirt=(.42,.25,.32),pants=(.23,.25,.26),eyewear='angular',skin=(.94,.89,.83)),
 dict(name='Ginger / stone overshirt and olive cap',hair='crop',hair_color=(.44,.23,.11),shirt=(.58,.57,.50),pants=(.34,.39,.42),headwear='cap',hat_color=(.11,.14,.075),skin=(1,.98,.92)),
 dict(name='Dark curls / chalk striped tee',hair='curls',hair_color=(.13,.105,.09),shirt=(.77,.74,.66),pants=(.34,.38,.29),stripe=True,skin=(.81,.70,.60)),
 dict(name='Dark sweep / honey overshirt',hair='swept',hair_color=(.14,.12,.10),shirt=(.64,.49,.28),pants=(.25,.31,.34),eyewear='angular',skin=(.78,.64,.53)),
 dict(name='Brown curls / blue tee and charcoal knit',hair='curls',hair_color=(.31,.21,.14),shirt=(.36,.46,.53),pants=(.53,.46,.35),headwear='beanie',hat_color=(.055,.065,.068),skin=(.96,.92,.86)),
 dict(name='Silver sweep / wine overshirt',hair='swept',hair_color=(.48,.47,.44),shirt=(.44,.25,.30),pants=(.29,.33,.27),eyewear='round',frame_color=(.10,.07,.035),skin=(.87,.81,.74)),
 dict(name='Chestnut curls / forest tee and canvas cap',hair='long',hair_color=(.33,.21,.13),shirt=(.28,.39,.32),pants=(.48,.55,.58),headwear='cap',hat_color=(.22,.135,.075),skin=(.71,.57,.47)),
 dict(name='Sandy sweep / teal overshirt',hair='swept',hair_color=(.49,.35,.22),shirt=(.24,.42,.43),pants=(.58,.51,.40),skin=(.98,.93,.85)),
]


def profile_for(index, role=None):
    spec=dict(PROFILES[index])
    spec['sex']='female' if index%2==0 else 'male'
    if role:
        spec.update(name='Café '+role,eyewear='none',headwear='none',hair_bun=False,
                    shirt=(.52,.57,.58) if role=='barista' else (.72,.67,.56),
                    hair_color=(.12,.09,.07) if role=='barista' else (.32,.18,.10))
    return spec


def _triangle(mask, points):
    """Rasterize a UV triangle into a small bounding box of an atlas mask."""
    size=mask.shape[0]
    p=np.asarray(points)*size
    x0=max(0,int(np.floor(p[:,0].min())));x1=min(size-1,int(np.ceil(p[:,0].max())))
    y0=max(0,int(np.floor(p[:,1].min())));y1=min(size-1,int(np.ceil(p[:,1].max())))
    if x1<x0 or y1<y0:return
    yy,xx=np.mgrid[y0:y1+1,x0:x1+1];xx=xx+.5;yy=yy+.5
    a,b,c=p;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
    if abs(den)<1e-7:return
    u=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
    v=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den
    mask[y0:y1+1,x0:x1+1]|=(u>=-.015)&(v>=-.015)&(u+v<=1.015)


def _expand(mask):
    # One texel of padding protects region edges at minified mip levels.
    out=mask.copy()
    for axis in (0,1):out|=np.roll(mask,1,axis)|np.roll(mask,-1,axis)
    return out


def apply_portrait_variation(body, rig, index, role=None):
    spec=profile_for(index,role);female=spec['sex']=='female'
    base=body.data.materials[0]
    source=next(n.image for n in base.node_tree.nodes if n.type=='TEX_IMAGE' and n.image)
    size=source.size[0]
    rgba=np.empty(size*source.size[1]*4,dtype=np.float32);source.pixels.foreach_get(rgba)
    rgba=rgba.reshape((source.size[1],size,4));rgb=rgba[:,:,:3].copy()
    uv=body.data.uv_layers.active.data;world=body.matrix_world.copy();inverse=world.inverted()
    masks=[np.zeros((size,size),dtype=bool) for _ in range(4)]
    hair_faces=[];region_ids=[]
    undershirt_mask=np.zeros((size,size),dtype=bool)
    coords=[world@v.co for v in body.data.vertices]
    for polygon in body.data.polygons:
        center=sum((coords[i] for i in polygon.vertices),Vector())/len(polygon.vertices)
        texcoords=[uv[i].uv.copy() for i in polygon.loop_indices]
        tc=sum(texcoords,Vector((0,0)))/len(texcoords)
        sample=rgb[int(tc.y*size)%size,int(tc.x*size)%size]
        luminance=float(np.dot(sample,[.2126,.7152,.0722]))
        if female:
            u,v=tc.x*size,(1-tc.y)*size
            hair_island=((70<u<210 and 815<v<1024) or (770<u<910 and 400<v<585) or (830<u<900 and 75<v<190)) and abs(center.x)<.18 and center.z>1.29
            brown=sample[0]>sample[1]*1.16 and sample[1]>sample[2]*1.06
            hair=hair_island or (brown and center.z>1.415 and abs(center.x)<.17 and
                  ((center.y>.028 and luminance<.67) or
                   (abs(center.x)>.072 and center.z>1.42 and luminance<.68) or
                   (center.z<1.52 and abs(center.x)>.045 and center.y<-.005 and luminance<.67) or
                   (center.z>1.635 and luminance<.58)))
        else:
            hair=(center.z>1.49 and abs(center.x)<.11 and luminance<.32 and
                  (center.y>-.012 or center.z>1.595 or abs(center.x)>.068))
        # Cloth is selected by its full torso/sleeve extent, independent of
        # the atlas's blue tint or dark shading. Color thresholds previously
        # missed neutral shoulder highlights and warmer jacket shadows.
        shirt=((1.005 if female else .925)<center.z<1.49 and abs(center.x)<.51)
        if not female and .78<center.z<=.925 and abs(center.x)<.30:
            # The hanging denim hem overlaps the trouser waist. Keep the
            # genuinely blue cloth here, while the upper torso is unconditional.
            shirt=luminance>.22 and sample[2]>sample[0]*1.025 and sample[1]>sample[0]*1.01
        if not female and abs(center.x)<.12 and center.y<-.015 and .78<center.z<1.37:
            for j in range(1,len(texcoords)-1):
                _triangle(undershirt_mask,[texcoords[0],texcoords[j],texcoords[j+1]])
        region=3 if hair else 1 if shirt else 2 if .14<center.z<(1.005 if female else .925) else 0
        region_ids.append(region)
        if hair:hair_faces.append(polygon)
        for j in range(1,len(texcoords)-1):_triangle(masks[region],[texcoords[0],texcoords[j],texcoords[j+1]])
    masks=[_expand(mask) for mask in masks]
    luma=rgb@np.array([.2126,.7152,.0722])
    skin_color=(rgb[:,:,0]>rgb[:,:,1]*1.12)&(rgb[:,:,1]>rgb[:,:,2]*1.055)&(luma>.20)
    skin=(masks[0]|masks[1]|masks[2])&skin_color&~masks[3]
    rgb[skin]*=np.array(spec['skin'])
    # Preserve the neutral white inner tee within the front opening only.
    neutral=(np.max(rgb,axis=2)-np.min(rgb,axis=2)<.14)&(luma>.38)&(rgb[:,:,0]>rgb[:,:,2]*.89)
    undershirt=_expand(undershirt_mask)&neutral
    # Dye garment pixels without tinting exposed skin, loose warm hair strands,
    # or the male overshirt's photographed inner tee.
    for region,color in [(1,spec['shirt']),(2,spec['pants']),(3,spec['hair_color'])]:
        mask=masks[region].copy()
        if region in (1,2):mask&=~skin_color&~undershirt
        if not np.any(mask):continue
        median=float(np.median(luma[mask]));shade=np.clip(luma/max(.03,median),.28,1.65)**.78
        dyed=shade[:,:,None]*np.array(color)
        rgb[mask]=dyed[mask]
    # Thin woven stripes are baked in geometric height space, below. They use
    # the source face UVs, so folds and seams remain visible.
    if spec.get('stripe'):
        stripe=np.zeros((size,size),dtype=bool)
        for polygon,region in zip(body.data.polygons,region_ids):
            if region!=1:continue
            z=sum(coords[i].z for i in polygon.vertices)/len(polygon.vertices)
            if int(z/.023)%4!=0:continue
            points=[uv[i].uv.copy() for i in polygon.loop_indices]
            for j in range(1,len(points)-1):_triangle(stripe,[points[0],points[j],points[j+1]])
        stripe&=~skin_color&~masks[3]
        rgb[stripe]*=np.array([.43,.48,.48])
    rgba[:,:,:3]=np.clip(rgb,0,1)
    atlas=bpy.data.images.new('Portrait '+str(index+1)+' '+(role or 'patron')+' atlas',width=size,height=size,alpha=True)
    atlas.colorspace_settings.name=source.colorspace_settings.name
    atlas.pixels.foreach_set(rgba.ravel());atlas.pack()
    # Region-specific roughness, a single shared painted image.
    body.data.materials.clear()
    for name,rough in [('skin and footwear',.64),('woven shirt',.83),('denim',.86),('hair strands',.76)]:
        material=base.copy();material.name='Portrait '+str(index+1)+' / '+name
        for node in material.node_tree.nodes:
            if node.type=='TEX_IMAGE':node.image=atlas
            elif node.type=='BSDF_PRINCIPLED':
                node.inputs['Roughness'].default_value=rough;node.inputs['Metallic'].default_value=0
                node.inputs['Specular IOR Level'].default_value=.18 if name=='hair strands' else .3
        body.data.materials.append(material)
    for polygon,region in zip(body.data.polygons,region_ids):polygon.material_index=region
    # Mesh variants change the hair silhouette and facial proportions while
    # leaving skeletal attachment points and source facial features intact.
    uses=np.zeros(len(body.data.vertices),dtype=np.int32);hair_uses=np.zeros_like(uses)
    for polygon,region in zip(body.data.polygons,region_ids):
        for i in polygon.vertices:
            uses[i]+=1
            if region==3:hair_uses[i]+=1
    width=[-.055,.025,.075,-.035,.035,-.02,.06,.045,-.035,.06,.015,-.025,-.045,.065,.04,-.03,.055,-.045][index]
    nose=[0,.003,-.004,.004,.002,-.003,.004,.001,-.002,-.004,.003,.004,.001,-.002,-.003,.003,-.001,.002][index]
    for vertex in body.data.vertices:
        c=coords[vertex.index].copy()
        if c.z>1.46:
            fade=min(1,max(0,(c.z-1.46)/.10));c.x*=1+width*fade
            if c.y<-.045:c.y-=math.exp(-((c.z-(1.57 if female else 1.545))/.055)**2)*nose
        is_hair=hair_uses[vertex.index]>.7*max(1,uses[vertex.index])
        # Source locks retain their complete surface continuity and skinning.
        # Gathering only a subset of textured strands creates stretched fins;
        # added tied-hair geometry provides the updo silhouette instead.
        if is_hair and not female:
            if spec['hair']=='crop' and c.z>1.60:c.z=1.60+(c.z-1.60)*.82
            elif spec['hair']=='swept' and c.z>1.60:c.x+=(c.z-1.60)*.15
        vertex.co=inverse@c
    body['portrait_name']=spec['name'];body['portrait_hair']=spec['hair'];body['portrait_source']=spec['sex']
    body['portrait_accessories']=', '.join(str(spec[k]) for k in ['eyewear','headwear','hair_bun'] if spec.get(k))
    return spec
