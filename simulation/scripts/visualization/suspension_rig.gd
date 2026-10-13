class_name SuspensionRig
extends Node3D

## Renders 4 high-tensile suspension cables connecting the balloon envelope collar
## down to the 4 arms of the lower motor frame assembly.
## Updates dynamically in real time to reflect payload pendulum swaying and motion.

@export var cable_color: Color = Color(0.92, 0.94, 0.98, 1.0) # High-visibility Vectran / steel cable
@export var envelope_view: EnvelopeView
@export var motor_frame: MotorFrame

var _immediate_mesh: ImmediateMesh
var _mesh_instance: MeshInstance3D
var _cable_material: StandardMaterial3D

func _ready() -> void:
	_immediate_mesh = ImmediateMesh.new()
	_mesh_instance = MeshInstance3D.new()
	_mesh_instance.name = "SuspensionCablesMesh"
	_mesh_instance.mesh = _immediate_mesh

	_cable_material = StandardMaterial3D.new()
	_cable_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_cable_material.albedo_color = cable_color
	_cable_material.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED

	_mesh_instance.material_override = _cable_material
	add_child(_mesh_instance)

func _process(_delta: float) -> void:
	if envelope_view == null or motor_frame == null:
		return

	var top_anchors: Array[Vector3] = envelope_view.get_suspension_anchors()
	var bottom_anchors: Array[Vector3] = motor_frame.get_suspension_anchor_positions()

	if top_anchors.is_empty() or bottom_anchors.size() < 4:
		return

	# Re-draw the 4 suspension cables connecting the collar to the 4 motor arms
	var inv_transform: Transform3D = global_transform.inverse()

	_immediate_mesh.clear_surfaces()
	_immediate_mesh.surface_begin(Mesh.PRIMITIVE_LINES)

	# 1. 4 Primary high-strength lines from Upper Equatorial Ring down to M1..M4
	for i in range(4):
		var top_world: Vector3 = top_anchors[i % top_anchors.size()]
		var bot_world: Vector3 = bottom_anchors[i]

		var top_local: Vector3 = inv_transform * top_world
		var bot_local: Vector3 = inv_transform * bot_world

		# Primary filament
		_immediate_mesh.surface_add_vertex(top_local)
		_immediate_mesh.surface_add_vertex(bot_local)

		# Parallel filament for visual thickness
		var perp: Vector3 = (bot_local - top_local).cross(Vector3.UP).normalized() * 0.007
		_immediate_mesh.surface_add_vertex(top_local + perp)
		_immediate_mesh.surface_add_vertex(bot_local + perp)
		_immediate_mesh.surface_add_vertex(top_local - perp)
		_immediate_mesh.surface_add_vertex(bot_local - perp)

	# 2. Anti-Twist Diagonal Cross-Stays (Triangulation preventing line twist / cable wrap)
	for i in range(4):
		var top_world: Vector3 = top_anchors[i % top_anchors.size()]
		var next_bot_world: Vector3 = bottom_anchors[(i + 1) % 4]

		var top_local: Vector3 = inv_transform * top_world
		var bot_local: Vector3 = inv_transform * next_bot_world

		_immediate_mesh.surface_add_vertex(top_local)
		_immediate_mesh.surface_add_vertex(bot_local)

	# 3. Equatorial Perimeter Tension Girdle (circles widest diameter between the 4 cleats)
	for i in range(4):
		var t1: Vector3 = inv_transform * top_anchors[i % top_anchors.size()]
		var t2: Vector3 = inv_transform * top_anchors[(i + 1) % top_anchors.size()]
		_immediate_mesh.surface_add_vertex(t1)
		_immediate_mesh.surface_add_vertex(t2)

	_immediate_mesh.surface_end()
