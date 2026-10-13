class_name TrajectoryVisualizer
extends Node3D

## Renders 3D historical flight paths, predicted physics trajectories, ground tracks,
## and multi-waypoint 3D route beacons.

@export var history_color: Color = Color(0.25, 0.73, 0.31, 0.95) # Aerospace green
@export var predicted_color: Color = Color(0.98, 0.75, 0.14, 0.95) # Amber forecast
@export var ground_track_color: Color = Color(0.35, 0.45, 0.55, 0.6) # Charcoal projection
@export var waypoint_color: Color = Color(0.22, 0.65, 1.0, 1.0) # Electric cyan
@export var waypoint_captured_color: Color = Color(0.3, 0.85, 0.4, 0.7) # Green captured

var _mesh_instance_history: MeshInstance3D
var _mesh_instance_predicted: MeshInstance3D
var _mesh_instance_ground: MeshInstance3D
var _mesh_instance_route: MeshInstance3D

var _immediate_history: ImmediateMesh
var _immediate_predicted: ImmediateMesh
var _immediate_ground: ImmediateMesh
var _immediate_route: ImmediateMesh

var _waypoint_nodes: Array[Node3D] = []
var _waypoint_labels: Array[Label3D] = []
var _waypoint_node: Node3D # Active waypoint compatibility reference
var _waypoint_label: Label3D

var _mat_history: StandardMaterial3D
var _mat_predicted: StandardMaterial3D
var _mat_ground: StandardMaterial3D
var _mat_route: StandardMaterial3D

func _ready() -> void:
	_setup_materials()
	_setup_mesh_instances()

func _setup_materials() -> void:
	_mat_history = StandardMaterial3D.new()
	_mat_history.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mat_history.albedo_color = history_color
	_mat_history.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_mat_history.render_priority = 2

	_mat_predicted = StandardMaterial3D.new()
	_mat_predicted.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mat_predicted.albedo_color = predicted_color
	_mat_predicted.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_mat_predicted.render_priority = 3

	_mat_ground = StandardMaterial3D.new()
	_mat_ground.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mat_ground.albedo_color = ground_track_color
	_mat_ground.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_mat_ground.render_priority = 1

	_mat_route = StandardMaterial3D.new()
	_mat_route.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mat_route.albedo_color = Color(0.25, 0.65, 1.0, 0.5)
	_mat_route.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA

func _setup_mesh_instances() -> void:
	_immediate_history = ImmediateMesh.new()
	_mesh_instance_history = MeshInstance3D.new()
	_mesh_instance_history.name = "HistoryMesh"
	_mesh_instance_history.mesh = _immediate_history
	_mesh_instance_history.material_override = _mat_history
	add_child(_mesh_instance_history)

	_immediate_predicted = ImmediateMesh.new()
	_mesh_instance_predicted = MeshInstance3D.new()
	_mesh_instance_predicted.name = "PredictedMesh"
	_mesh_instance_predicted.mesh = _immediate_predicted
	_mesh_instance_predicted.material_override = _mat_predicted
	add_child(_mesh_instance_predicted)

	_immediate_ground = ImmediateMesh.new()
	_mesh_instance_ground = MeshInstance3D.new()
	_mesh_instance_ground.name = "GroundMesh"
	_mesh_instance_ground.mesh = _immediate_ground
	_mesh_instance_ground.material_override = _mat_ground
	add_child(_mesh_instance_ground)

	_immediate_route = ImmediateMesh.new()
	_mesh_instance_route = MeshInstance3D.new()
	_mesh_instance_route.name = "RouteMesh"
	_mesh_instance_route.mesh = _immediate_route
	_mesh_instance_route.material_override = _mat_route
	add_child(_mesh_instance_route)

## Instantiates visual 3D markers for all waypoints in the mission route.
func setup_waypoints(wp_list: Array[Vector3]) -> void:
	for n in _waypoint_nodes:
		if n != null:
			n.queue_free()
	_waypoint_nodes.clear()
	_waypoint_labels.clear()

	for i in range(wp_list.size()):
		var p: Vector3 = wp_list[i]
		var w_node: Node3D = Node3D.new()
		w_node.name = "Waypoint_%d" % (i + 1)
		w_node.position = p
		add_child(w_node)
		_waypoint_nodes.append(w_node)

		# Ring
		var ring: MeshInstance3D = MeshInstance3D.new()
		var r_mesh: TorusMesh = TorusMesh.new()
		r_mesh.inner_radius = 16.0
		r_mesh.outer_radius = 18.0
		ring.mesh = r_mesh
		var r_mat: StandardMaterial3D = StandardMaterial3D.new()
		r_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		r_mat.albedo_color = waypoint_color
		ring.material_override = r_mat
		ring.rotation_degrees = Vector3(90.0, 0.0, 0.0)
		w_node.add_child(ring)

		# Vertical beacon beam
		var beam: MeshInstance3D = MeshInstance3D.new()
		var b_mesh: CylinderMesh = CylinderMesh.new()
		b_mesh.top_radius = 0.4
		b_mesh.bottom_radius = 0.4
		b_mesh.height = 350.0
		beam.mesh = b_mesh
		var b_mat: StandardMaterial3D = StandardMaterial3D.new()
		b_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		b_mat.albedo_color = Color(waypoint_color.r, waypoint_color.g, waypoint_color.b, 0.25)
		b_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		beam.material_override = b_mat
		beam.position = Vector3(0.0, 175.0, 0.0)
		w_node.add_child(beam)

		# Label
		var lbl: Label3D = Label3D.new()
		lbl.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		lbl.font_size = 24
		lbl.outline_size = 5
		lbl.modulate = waypoint_color
		lbl.position = Vector3(0.0, 24.0, 0.0)
		lbl.text = "WAYPOINT %d\n[%0.0f, %0.0f, %0.0f]" % [i + 1, p.x, p.y, p.z]
		w_node.add_child(lbl)
		_waypoint_labels.append(lbl)

	if not _waypoint_nodes.is_empty():
		_waypoint_node = _waypoint_nodes[0]
		_waypoint_label = _waypoint_labels[0]

	# Draw connecting route lines
	_draw_route_line(wp_list)

func _draw_route_line(wp_list: Array[Vector3]) -> void:
	if _immediate_route == null:
		return
	_immediate_route.clear_surfaces()
	if wp_list.size() >= 2:
		_immediate_route.surface_begin(Mesh.PRIMITIVE_LINE_STRIP)
		for p in wp_list:
			_immediate_route.surface_add_vertex(p)
		_immediate_route.surface_end()

func set_waypoint_position(pos: Vector3, dist_to_target: float) -> void:
	if _waypoint_node != null:
		if is_inside_tree():
			_waypoint_node.global_position = pos
		else:
			_waypoint_node.position = pos
	if _waypoint_label != null:
		_waypoint_label.text = "NAV WAYPOINT TGT\nPOS: [%0.0f, %0.0f, %0.0f]\nDIST: %0.0fm" % [pos.x, pos.y, pos.z, dist_to_target]

## Updates lines based on signals from TrajectoryPredictor.
func update_tracks(history: PackedVector3Array, predicted: PackedVector3Array, ground: PackedVector3Array) -> void:
	# 1. Historical track
	_immediate_history.clear_surfaces()
	if history.size() >= 2:
		_immediate_history.surface_begin(Mesh.PRIMITIVE_LINE_STRIP)
		for p in history:
			_immediate_history.surface_add_vertex(p)
		_immediate_history.surface_end()

	# 2. Predicted forecast track
	_immediate_predicted.clear_surfaces()
	if predicted.size() >= 2:
		_immediate_predicted.surface_begin(Mesh.PRIMITIVE_LINE_STRIP)
		for p in predicted:
			_immediate_predicted.surface_add_vertex(p)
		_immediate_predicted.surface_end()

	# 3. Ground projected track
	_immediate_ground.clear_surfaces()
	if ground.size() >= 2:
		_immediate_ground.surface_begin(Mesh.PRIMITIVE_LINE_STRIP)
		for p in ground:
			_immediate_ground.surface_add_vertex(p)
		_immediate_ground.surface_end()
