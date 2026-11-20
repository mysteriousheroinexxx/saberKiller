# Export only the animation rig from a Mixamo GLB. This keeps action clips
# reusable without shipping a duplicate copy of a large character mesh.
# Usage:
#   blender --background --python blender_animation.py -- in.glb out.glb
import bpy, sys

args = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = args[0], args[1]

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=SRC)

armatures = [o for o in bpy.data.objects if o.type == 'ARMATURE']
if not armatures:
    raise RuntimeError('No armature found in Mixamo source')
for arm in armatures:
    arm.scale = (1, 1, 1)
for obj in list(bpy.data.objects):
    if obj.type != 'ARMATURE':
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.context.view_layer.update()

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=DST,
    export_format='GLB',
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
    export_skins=True,
    export_yup=True,
    export_apply=False,
)
print('EXPORTED ANIMATION RIG', DST)
