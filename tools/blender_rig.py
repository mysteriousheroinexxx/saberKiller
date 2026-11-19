"""Rig saber.glb in Blender: biped armature, auto weights, sword in hand,
Walk/Attack/Death actions, export animated GLB. Run headless:
  blender --background --python blender_rig.py
"""
import bpy, math, sys
from mathutils import Vector, Matrix

SRC = "/home/mhxxx/AI/test2/doom-zombies/assets/saber.glb"
OUT = "/home/mhxxx/AI/test2/doom-zombies/assets/saber_animated.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print("IMPORTED:", [(o.name, len(o.data.vertices)) for o in meshes])

# ---- clean the Sketchfab import hierarchy ----
# Bake each mesh's world transform into its data, drop parents, delete the
# leftover empties. The glTF exporter drops the skin if the skinned mesh
# still lives under the imported empty hierarchy.
from mathutils import Matrix
for o in meshes:
    mw = o.matrix_world.copy()
    o.data.transform(mw)
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
for o in list(bpy.data.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.update()
print("CLEANED: meshes at identity, empties removed")

# world-space bounds helper
def wbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector((min(p[i] for p in pts) for i in range(3)))
    mx = Vector((max(p[i] for p in pts) for i in range(3)))
    return mn, mx

# classify: body = most verts; head = small & highest; swords = the rest
meshes.sort(key=lambda o: len(o.data.vertices), reverse=True)
body = meshes[0]
bmn, bmx = wbox(body)
H = bmx.z - bmn.z
print("BODY H:", H, "bounds:", bmn, bmx)
head = None
for o in meshes[1:]:
    mn, mx = wbox(o)
    size = mx - mn
    if size.length < (bmx - bmn).length * 0.35:
        c = (mn + mx) / 2
        if head is None or c.z > (wbox(head)[0] + wbox(head)[1]).z / 2:
            head = o
swords = [o for o in meshes if o is not body and o is not head]
print("HEAD:", head.name if head else None, "| SWORDS:", [s.name for s in swords])
assert head and swords

cx = (bmn.x + bmx.x) / 2
cy = (bmn.y + bmx.y) / 2
z0 = bmn.z
def P(fx, fz):  # proportional point: fx fraction of H in x, fz fraction in z
    return Vector((cx + fx * H, cy, z0 + fz * H))

# ---------------- armature ----------------
arm_data = bpy.data.armatures.new("SaberRig")
arm = bpy.data.objects.new("SaberRig", arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
def bone(name, head, tail, parent=None):
    b = eb.new(name)
    b.head = head; b.tail = tail; b.roll = 0
    if parent: b.parent = eb[parent]
    return b
bone("Hips",      P(0, .52), P(0, .62))
bone("Spine",     P(0, .62), P(0, .74), "Hips")
bone("Chest",     P(0, .74), P(0, .81), "Spine")
bone("Neck",      P(0, .81), P(0, .86), "Chest")
bone("Head",      P(0, .86), P(0, .97), "Neck")
for s, sx in (("L", 1), ("R", -1)):
    bone(f"Shoulder.{s}", P(.03*sx, .79), P(.15*sx, .79), "Chest")
    bone(f"UpperArm.{s}", P(.15*sx, .79), P(.23*sx, .62), f"Shoulder.{s}")
    bone(f"Forearm.{s}",  P(.23*sx, .62), P(.29*sx, .48), f"UpperArm.{s}")
    bone(f"Hand.{s}",     P(.29*sx, .48), P(.32*sx, .42), f"Forearm.{s}")
    bone(f"Thigh.{s}",    P(.085*sx, .50), P(.085*sx, .27), "Hips")
    bone(f"Shin.{s}",     P(.085*sx, .27), P(.085*sx, .06), f"Thigh.{s}")
    bone(f"Foot.{s}",     P(.085*sx, .06), P(.085*sx, .06) + Vector((0, .07*H, -.02*H)), f"Shin.{s}")
bpy.ops.object.mode_set(mode='OBJECT')
print("ARMATURE bones:", len(arm_data.bones))

# ---------------- bind body ----------------
# Try bone-heat AUTO weights on a CLEANED mesh (merge doubles / recalc normals
# / delete loose). Auto weights give anatomical limb binding; the earlier
# failure was mesh junk. Fall back to proximity weights if auto yields none.
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length

def proximity_weights():
    for g in list(body.vertex_groups): body.vertex_groups.remove(g)
    for m in list(body.modifiers):
        if m.type == 'ARMATURE': body.modifiers.remove(m)
    body.parent = arm
    mod = body.modifiers.new("Armature", "ARMATURE"); mod.object = arm
    segs = [(bn, arm.matrix_world @ arm.data.bones[bn].head_local,
                 arm.matrix_world @ arm.data.bones[bn].tail_local)
            for bn in arm.data.bones.keys()]
    groups = {bn: body.vertex_groups.new(name=bn) for bn, _, _ in segs}
    bmw = body.matrix_world
    for v in body.data.vertices:
        p = bmw @ v.co
        ds = sorted(((seg_dist(p, a, b), bn) for bn, a, b in segs))[:3]
        w = [1.0 / max(d, 1e-4) ** 2 for d, _ in ds]; s = sum(w)
        for (d, bn), wi in zip(ds, w): groups[bn].add([v.index], wi / s, 'REPLACE')

# clean mesh
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.0001)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.mesh.delete_loose()
bpy.ops.object.mode_set(mode='OBJECT')
# auto weights
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
try:
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
except Exception as e:
    print("AUTO WEIGHTS op failed:", e)
nz = sum(1 for v in body.data.vertices if any(g.weight > 0.001 for g in v.groups))
print("AUTO WEIGHTS nz:", nz, "/", len(body.data.vertices))
if nz < len(body.data.vertices) * 0.5:
    print("-> falling back to proximity weights")
    proximity_weights()
    nz = sum(1 for v in body.data.vertices if any(g.weight > 0.001 for g in v.groups))
# smooth weights + limit bones/vertex to reduce spindly limb stretching
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); bpy.context.view_layer.objects.active = body
try:
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=3, expand=0.5)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=3)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    print("WEIGHT SMOOTH: ok")
except Exception as e:
    print("WEIGHT SMOOTH failed:", e)
    try: bpy.ops.object.mode_set(mode='OBJECT')
    except: pass
# per-bone weight distribution
dist = {}
for v in body.data.vertices:
    for g in v.groups:
        if g.weight > 0.05:
            n = body.vertex_groups[g.group].name
            dist[n] = dist.get(n, 0) + 1
print("WEIGHT DIST:", sorted(dist.items(), key=lambda x: -x[1])[:10])
assert nz > 0, "skinning produced no weights"

# ---------------- rigid bone-parent head + swords ----------------
def bone_parent(child, bname, world_fix=True):
    mw = child.matrix_world.copy()
    child.parent = arm
    child.parent_type = 'BONE'
    child.parent_bone = bname
    if world_fix:
        child.matrix_world = mw

bone_parent(head, "Head")

# join swords into one, grip in right hand, blade hanging down
bpy.ops.object.select_all(action='DESELECT')
for s in swords: s.select_set(True)
bpy.context.view_layer.objects.active = swords[0]
bpy.ops.object.join()
sword = bpy.context.view_layer.objects.active
sword.name = "Excalibur"
smn, smx = wbox(sword)
sh = smx.z - smn.z
# hand bone world position (tail of Hand.R ~ grip)
pb = arm.pose.bones["Hand.R"]
hand_pos = arm.matrix_world @ pb.tail
# move sword so its 78%-height point (grip zone) sits at the hand, blade down
grip = Vector(((smn.x + smx.x) / 2, (smn.y + smx.y) / 2, smn.z + sh * .78))
delta = hand_pos - grip
sword.location += delta
bpy.context.view_layer.update()
bone_parent(sword, "Hand.R")
print("SWORD gripped at", hand_pos)

# ---------------- (eyes removed: use clean base model, no zombie reskin) ----------------

# ---------------- actions ----------------
for pb in arm.pose.bones:
    pb.rotation_mode = 'XYZ'

# Point a bone's Y axis toward a world (armature-space) direction, regardless
# of its rest orientation. Euler-X twists diagonal arm bones; this swings them
# correctly. Forward in Blender is +Y (exports to glTF -Z = game front).
from mathutils import Quaternion
def aim_bone(name, frame, direction):
    pb = arm.pose.bones[name]
    pb.rotation_mode = 'XYZ'
    bone = arm.data.bones[name]
    m = bone.matrix_local.copy(); p = bone.parent
    while p:
        m = p.matrix_local @ m; p = p.parent
    M = m.to_3x3()
    T = Vector(direction).normalized()
    T_local = M.inverted() @ T
    Q = Vector((0, 1, 0)).rotation_difference(T_local)
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = Q
    pb.keyframe_insert('rotation_quaternion', frame=frame)

def key(pbname, frame, rot=None, loc=None):
    pb = arm.pose.bones[pbname]
    if rot is not None:
        pb.rotation_euler = rot
        pb.keyframe_insert("rotation_euler", frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=frame)

def new_action(name):
    act = bpy.data.actions.new(name)
    if not arm.animation_data: arm.animation_data_create()
    arm.animation_data.action = act
    return act

def action_fcurves(act):
    fcs = []
    for layer in act.layers:
        for strip in layer.strips:
            for slot in act.slots:
                cb = strip.channelbag(slot)
                if cb: fcs.extend(cb.fcurves)
    return fcs

D = math.radians
# ---- WALK: stiff zombie shuffle, 40-frame loop, arms reaching forward ----
new_action("Walk")
for f, ph in ((1, 0), (11, 1), (21, 2), (31, 3), (41, 0)):
    s = math.sin(ph * math.pi / 2)  # 0,1,0,-1,0
    key("Hips", f, rot=(D(-3), 0, D(2.5) * s))
    key("Spine", f, rot=(D(-7), 0, D(-2) * s))
    key("Chest", f, rot=(D(-5), 0, 0))
    key("Head", f, rot=(D(-8) + D(4) * s, 0, D(7) * math.sin(ph * math.pi / 4)))
    key("Thigh.L", f, rot=(D(14) * s, 0, 0))
    key("Thigh.R", f, rot=(D(-14) * s, 0, 0))
    key("Shin.L", f, rot=(D(-10) * max(0, -s), 0, 0))
    key("Shin.R", f, rot=(D(-10) * max(0, s), 0, 0))
    key("Foot.L", f, rot=(D(5) * s, 0, 0))
    key("Foot.R", f, rot=(D(-5) * s, 0, 0))
    aim_bone("UpperArm.L", f, (0.20 + 0.06 * s, 1, -0.35))
    aim_bone("UpperArm.R", f, (-0.20 + 0.06 * s, 1, -0.35))
    key("Forearm.L", f, rot=(D(22), 0, 0))
    key("Forearm.R", f, rot=(D(22), 0, 0))
    key("Hand.L", f, rot=(D(10), 0, 0))
    key("Hand.R", f, rot=(D(10), 0, 0))

# ---- ATTACK: sword raise + diagonal swing, 24 frames ----
new_action("Attack")
key("Hips", 1, rot=(D(-3), 0, 0)); key("Spine", 1, rot=(D(-7), 0, 0))
aim_bone("UpperArm.R", 1, (-0.20, 1, -0.35)); key("Forearm.R", 1, rot=(D(22), 0, 0))
aim_bone("UpperArm.L", 1, (0.20, 1, -0.35))
key("Hips", 6, rot=(D(-3), 0, D(10))); key("Spine", 6, rot=(D(-10), 0, D(14)))
aim_bone("UpperArm.R", 6, (-0.45, -0.55, -0.7)); key("Forearm.R", 6, rot=(D(50), 0, 0))
key("Hips", 12, rot=(D(-6), 0, D(-12))); key("Spine", 12, rot=(D(-16), 0, D(-18)))
key("Chest", 12, rot=(D(-8), 0, D(-10)))
aim_bone("UpperArm.R", 12, (-0.15, 1, 0.45)); key("Forearm.R", 12, rot=(D(8), 0, 0))
key("Hand.R", 12, rot=(D(-20), 0, 0))
aim_bone("UpperArm.L", 12, (0.25, 1, -0.2))
key("Hips", 24, rot=(D(-3), 0, 0)); key("Spine", 24, rot=(D(-7), 0, 0))
key("Chest", 24, rot=(0, 0, 0))
aim_bone("UpperArm.R", 24, (-0.20, 1, -0.35)); key("Forearm.R", 24, rot=(D(22), 0, 0))
key("Hand.R", 24, rot=(D(10), 0, 0))
aim_bone("UpperArm.L", 24, (0.20, 1, -0.35))

# ---- DEATH: buckle and fall backward, 30 frames ----
new_action("Death")
key("Hips", 1, rot=(0, 0, 0), loc=(0, 0, 0))
key("Spine", 1, rot=(D(-7), 0, 0)); key("Head", 1, rot=(D(-8), 0, 0))
key("Thigh.L", 1, rot=(0, 0, 0)); key("Thigh.R", 1, rot=(0, 0, 0))
aim_bone("UpperArm.L", 1, (0.20, 1, -0.35)); aim_bone("UpperArm.R", 1, (-0.20, 1, -0.35))
key("Hips", 10, rot=(D(35), 0, D(5)), loc=(0, -0.15, 0))
key("Spine", 10, rot=(D(15), 0, 0)); key("Head", 10, rot=(D(20), 0, D(10)))
key("Thigh.L", 10, rot=(D(-30), 0, 0)); key("Thigh.R", 10, rot=(D(-20), 0, 0))
key("Shin.L", 10, rot=(D(40), 0, 0)); key("Shin.R", 10, rot=(D(30), 0, 0))
key("Hips", 30, rot=(D(85), 0, D(8)), loc=(0, -0.55, 0))
key("Spine", 30, rot=(D(25), 0, 0)); key("Chest", 30, rot=(D(10), 0, 0))
key("Head", 30, rot=(D(30), 0, D(15)))
key("Thigh.L", 30, rot=(D(-15), 0, 0)); key("Thigh.R", 30, rot=(D(-5), 0, 0))
key("Shin.L", 30, rot=(D(20), 0, 0)); key("Shin.R", 30, rot=(D(10), 0, 0))
aim_bone("UpperArm.L", 30, (0.35, 0.3, -0.6)); aim_bone("UpperArm.R", 30, (-0.35, 0.3, -0.6))
key("Forearm.L", 30, rot=(D(10), 0, 0)); key("Forearm.R", 30, rot=(D(10), 0, 0))

# ---------------- export ----------------
walk_act = bpy.data.actions['Walk']
print("WALK slots:", len(walk_act.slots), "layers:", len(walk_act.layers))
for bn in ('UpperArm.L', 'Thigh.L'):
    for fc in action_fcurves(walk_act):
        if bn in fc.data_path and 'rotation' in fc.data_path:
            pts = [round(k.co[1], 3) for k in fc.keyframe_points]
            print("FCURVE", fc.data_path, "axis", fc.array_index, "vals", pts[:5])
            break
arm.animation_data.action = walk_act
arm.animation_data.action_slot = walk_act.slots[0]
bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
for bn in ('UpperArm.L', 'UpperArm.R', 'Head', 'Thigh.L'):
    pb = arm.pose.bones[bn]
    d = (pb.tail - pb.head).normalized()
    print("POSEDIR", bn, tuple(round(v, 2) for v in d),
          "evalEuler", tuple(round(v, 3) for v in pb.rotation_euler), "mode", pb.rotation_mode)
print("DEBUG body.parent:", body.parent, body.parent_type)
print("DEBUG body modifiers:", [(m.type, getattr(m, 'object', None)) for m in body.modifiers])
print("DEBUG body vgroups:", len(body.vertex_groups), [g.name for g in body.vertex_groups][:8])
print("DEBUG head.parent:", head.parent, head.parent_type, head.parent_bone)
print("DEBUG sword.parent:", sword.parent, sword.parent_type, sword.parent_bone)
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    if o.type in ('MESH', 'ARMATURE'): o.select_set(True)
bpy.context.view_layer.objects.active = arm
print("DEBUG selected:", [o.name for o in bpy.context.selected_objects])
print("DEBUG arm visible:", arm.visible_get(), "hide_render:", arm.hide_render)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB',
    use_selection=False, export_animations=False,
    export_animation_mode='ACTIONS', export_force_sampling=True,
    export_skins=True, export_yup=True, export_apply=False)
print("EXPORTED:", OUT)
print("ACTIONS:", [a.name for a in bpy.data.actions])
# verify round-trip
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=OUT)
for o in bpy.data.objects:
    if o.type == 'MESH':
        print("ROUNDTRIP:", o.name, "mods:", [m.type for m in o.modifiers],
              "vgroups:", len(o.vertex_groups), "parent:", o.parent_type if o.parent else None)
print("ROUNDTRIP armatures:", [o.name for o in bpy.data.objects if o.type == 'ARMATURE'])
