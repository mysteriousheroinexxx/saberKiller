# Normalize a raw Mixamo GLB for three.js: delete stray objects, set Armature
# scale to 1 (mesh meters vs bone cm mismatch under 0.01 scale breaks skinning),
# re-export. Usage:
#   blender --background --python blender_clean.py -- in.glb out_clean.glb
import bpy, sys
from mathutils import Vector
A = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = A[0], A[1]
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=SRC)
rem = []
for o in list(bpy.data.objects):
    if o.type == 'ARMATURE': continue
    if o.type == 'MESH' and o.vertex_groups: continue
    rem.append(o.name); bpy.data.objects.remove(o, do_unlink=True)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
arm.scale = (1, 1, 1)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB',
    export_animations=True, export_animation_mode='ACTIONS',
    export_force_sampling=True, export_skins=True, export_yup=True,
    export_apply=False)
print("REMOVED", rem, "EXPORTED", DST)
