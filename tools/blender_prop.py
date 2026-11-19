# Low-poly prop generator: metal barrel -> assets/prop_barrel.glb
# Run: env -i HOME=$HOME PATH=/usr/bin:/bin DISPLAY=:0 \
#   ~/bin/blender-5.3.0-linux-x64/blender --background --python tools/blender_prop.py -- assets/prop_barrel.glb
import bpy, sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = argv[0] if argv else 'assets/prop_barrel.glb'

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
for m in list(bpy.data.meshes):
    bpy.data.meshes.remove(m)


def mat(name, color, metallic=0.6, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    return m


body_mat = mat('BarrelBody', (0.25, 0.30, 0.35))
ring_mat = mat('BarrelRing', (0.15, 0.15, 0.18), 0.8, 0.4)

bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.34, depth=0.9, location=(0, 0, 0.45))
body = bpy.context.object
body.name = 'BarrelBody'
body.data.materials.append(body_mat)

for z in (0.22, 0.68):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.345, minor_radius=0.025,
                                     major_segments=14, minor_segments=6, location=(0, 0, z))
    r = bpy.context.object
    r.name = 'BarrelRing'
    r.data.materials.append(ring_mat)

bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.32, depth=0.03, location=(0, 0, 0.9))
lid = bpy.context.object
lid.name = 'BarrelLid'
lid.data.materials.append(ring_mat)

bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.name = 'PropBarrel'

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True)
print('EXPORTED', out)
