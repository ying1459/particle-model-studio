import os
import random
import sys

import bpy
from mathutils import Vector


def output_path_from_args():
    if "--" in sys.argv:
        index = sys.argv.index("--")
        if len(sys.argv) > index + 1:
            return sys.argv[index + 1]
    return ""


OUT_PATH = output_path_from_args()
if not OUT_PATH:
    raise RuntimeError("Missing output path.")

try:
    bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
except Exception as exc:
    print("gltf addon enable skipped:", exc)

scene = bpy.context.scene
try:
    scene.frame_set(scene.frame_start)
except Exception:
    pass


def visible_meshish(obj):
    return obj.type in {"MESH", "CURVE", "SURFACE", "FONT", "META"} and obj.visible_get()


def visible_convertible(obj):
    return obj.type in {"CURVE", "SURFACE", "FONT", "META"} and obj.visible_get()


def curve_start_local(curve_data):
    if not curve_data.splines:
        return Vector((0, 0, 0))
    spline = curve_data.splines[0]
    if getattr(spline, "bezier_points", None) and spline.bezier_points:
        return spline.bezier_points[0].co.copy()
    if getattr(spline, "points", None) and spline.points:
        point = spline.points[0].co
        w = point.w if abs(point.w) > 1e-6 else 1.0
        return Vector((point.x / w, point.y / w, point.z / w))
    return Vector((0, 0, 0))


def curve_reveal_keyframes(curve_data):
    action = curve_data.animation_data.action if curve_data.animation_data else None
    if not action:
        return []
    end_curve = next((fc for fc in iter_action_fcurves(action) if fc.data_path == "bevel_factor_end"), None)
    if not end_curve:
        return []
    return [
        (
            key.co.x,
            max(0.0, min(1.0, key.co.y)),
            key.interpolation,
            key.easing,
        )
        for key in end_curve.keyframe_points
    ]


def iter_action_fcurves(action):
    if not action:
        return []

    curves = []
    if hasattr(action, "fcurves"):
        try:
            curves.extend(list(action.fcurves))
        except Exception:
            pass

    if hasattr(action, "layers"):
        try:
            for layer in action.layers:
                for strip in layer.strips:
                    bags = list(getattr(strip, "channelbags", []) or [])
                    bag = getattr(strip, "channelbag", None)
                    if bag and bag not in bags:
                        bags.append(bag)
                    for channelbag in bags:
                        curves.extend(list(getattr(channelbag, "fcurves", []) or []))
        except Exception:
            pass

    return curves


def keyframe_shape_key_value(shape_keys, key_block, keyframes):
    shape_keys.animation_data_create()
    for frame, value, _interpolation, _easing in keyframes:
        key_block.value = value
        key_block.keyframe_insert(data_path="value", frame=frame)

    action = shape_keys.animation_data.action if shape_keys.animation_data else None
    target_path = 'key_blocks["%s"].value' % key_block.name
    target_curves = [fc for fc in iter_action_fcurves(action) if fc.data_path == target_path]
    for fcurve in target_curves:
        for key, source in zip(fcurve.keyframe_points, keyframes):
            _frame, _value, interpolation, easing = source
            key.interpolation = interpolation
            key.easing = easing
        fcurve.update()


def bake_animated_curves_to_morph_meshes():
    baked = []
    for obj in list(scene.objects):
        if obj.type != "CURVE" or not obj.visible_get():
            continue
        keyframes = curve_reveal_keyframes(obj.data)
        if len(keyframes) < 2:
            continue
        source_name = obj.name

        duplicate = obj.copy()
        duplicate.data = obj.data.copy()
        duplicate.animation_data_clear()
        duplicate.data.animation_data_clear()
        duplicate.data.bevel_factor_start = 0.0
        duplicate.data.bevel_factor_end = 1.0
        duplicate.name = (source_name or "Curve") + "_baked_reveal"
        scene.collection.objects.link(duplicate)

        bpy.ops.object.select_all(action="DESELECT")
        duplicate.hide_select = False
        duplicate.select_set(True)
        bpy.context.view_layer.objects.active = duplicate
        bpy.ops.object.convert(target="MESH")
        mesh_obj = bpy.context.object
        if not mesh_obj or mesh_obj.type != "MESH" or not mesh_obj.data.vertices:
            continue

        start = curve_start_local(obj.data)
        final_positions = [vertex.co.copy() for vertex in mesh_obj.data.vertices]
        basis = mesh_obj.shape_key_add(name="Basis")
        reveal = mesh_obj.shape_key_add(name="Curve Reveal")
        for index, final in enumerate(final_positions):
            basis.data[index].co = start
            reveal.data[index].co = final
        reveal.value = 0.0

        keyframe_shape_key_value(mesh_obj.data.shape_keys, reveal, keyframes)

        bpy.data.objects.remove(obj, do_unlink=True)
        baked.append(mesh_obj)
        print("Baked curve reveal animation", source_name, "vertices", len(mesh_obj.data.vertices))
    return baked


def convert_particle_systems_to_preview_meshes(max_total=220000):
    remaining = max_total
    rng = random.Random(91827)
    for obj in list(scene.objects):
        if remaining <= 0 or not getattr(obj, "particle_systems", None):
            continue
        color = (0.85, 0.85, 0.85, 1.0)
        if obj.active_material and hasattr(obj.active_material, "diffuse_color"):
            color = tuple(obj.active_material.diffuse_color)
        for psys in obj.particle_systems:
            particles = list(getattr(psys, "particles", []))
            if not particles or remaining <= 0:
                continue
            sample_count = min(len(particles), remaining)
            stride = max(1, len(particles) // max(sample_count, 1))
            verts = []
            faces = []
            size = float(getattr(psys.settings, "particle_size", 0.05) or 0.05)
            point_size = max(0.002, min(0.035, size * 0.08))
            used = 0
            for particle in particles[::stride]:
                if used >= sample_count:
                    break
                try:
                    loc = obj.matrix_world @ particle.location
                except Exception:
                    loc = Vector(particle.location)
                axis = Vector((rng.random() - 0.5, rng.random() - 0.5, rng.random() - 0.5))
                if axis.length < 1e-5:
                    axis = Vector((1, 0, 0))
                axis.normalize()
                tangent = axis.cross(Vector((0, 1, 0)))
                if tangent.length < 1e-5:
                    tangent = axis.cross(Vector((1, 0, 0)))
                tangent.normalize()
                bitangent = axis.cross(tangent)
                bitangent.normalize()
                i = len(verts)
                verts.extend(
                    [
                        tuple(loc + tangent * point_size),
                        tuple(loc - tangent * point_size * 0.55 + bitangent * point_size * 0.86),
                        tuple(loc - tangent * point_size * 0.55 - bitangent * point_size * 0.86),
                    ]
                )
                faces.append((i, i + 1, i + 2))
                used += 1
            if verts:
                mesh = bpy.data.meshes.new((obj.name or "Object") + "_particle_points_mesh")
                mesh.from_pydata(verts, [], faces)
                mesh.update()
                material = bpy.data.materials.new((obj.name or "Object") + "_particle_preview")
                material.diffuse_color = color
                cloud = bpy.data.objects.new((obj.name or "Object") + "_particle_points", mesh)
                scene.collection.objects.link(cloud)
                cloud.data.materials.append(material)
                remaining -= used
                print("Converted particle system", obj.name, psys.name, "points", used)


def make_instances_real():
    try:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in scene.objects:
            if obj.visible_get():
                obj.hide_select = False
                obj.select_set(True)
        bpy.ops.object.duplicates_make_real(use_base_parent=True, use_hierarchy=True)
    except Exception as exc:
        print("make instances real skipped:", exc)


def convert_visible_to_mesh():
    try:
        bpy.ops.object.select_all(action="DESELECT")
        active = None
        for obj in list(scene.objects):
            if visible_convertible(obj):
                obj.hide_select = False
                obj.select_set(True)
                active = active or obj
        if active:
            bpy.context.view_layer.objects.active = active
            bpy.ops.object.convert(target="MESH")
    except Exception as exc:
        print("object convert skipped:", exc)


bake_animated_curves_to_morph_meshes()
convert_particle_systems_to_preview_meshes()
make_instances_real()
convert_visible_to_mesh()

for obj in scene.objects:
    obj.select_set(False)
    if obj.type in {"CAMERA", "LIGHT"}:
        obj.hide_viewport = True
        obj.hide_render = True

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
kwargs = {
    "filepath": OUT_PATH,
    "export_format": "GLB",
    "use_selection": False,
}
optional = {
    "export_animations": True,
    "export_nla_strips": True,
    "export_materials": "EXPORT",
    "export_texcoords": True,
    "export_normals": True,
    "export_skins": True,
    "export_morph": True,
    "export_morph_animation": True,
    "export_bake_animation": True,
    "export_animation_mode": "ACTIONS",
    "export_yup": True,
    "export_apply": True,
}
try:
    supported = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
except Exception:
    supported = set(optional.keys())
for key, value in optional.items():
    if key in supported:
        kwargs[key] = value

try:
    bpy.ops.export_scene.gltf(**kwargs)
except TypeError:
    kwargs.pop("export_apply", None)
    kwargs.pop("export_nla_strips", None)
    bpy.ops.export_scene.gltf(**kwargs)

print("Particle Model Studio BLEND export:", OUT_PATH)
