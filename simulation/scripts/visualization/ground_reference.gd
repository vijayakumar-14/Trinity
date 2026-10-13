class_name GroundReference
extends Node3D

## 3D Ground reference system with launch pad, geospatial grid lines, and distance rings.

func _ready() -> void:
	_build_ground_plane()
	_build_launch_pad()
	_build_distance_rings()

func _build_ground_plane() -> void:
	var plane_mesh: PlaneMesh = PlaneMesh.new()
	plane_mesh.size = Vector2(10000.0, 10000.0)

	var mat: StandardMaterial3D = StandardMaterial3D.new()
	mat.albedo_color = Color(0.20, 0.23, 0.28) # Clean proving ground terrain
	mat.roughness = 0.88
	mat.metallic = 0.08

	var inst: MeshInstance3D = MeshInstance3D.new()
	inst.name = "GroundTerrain"
	inst.mesh = plane_mesh
	inst.material_override = mat
	inst.position = Vector3(0.0, -0.05, 0.0)
	add_child(inst)

func _build_launch_pad() -> void:
	# Launch pad circular concrete apron
	var pad_mesh: CylinderMesh = CylinderMesh.new()
	pad_mesh.top_radius = 28.0
	pad_mesh.bottom_radius = 28.0
	pad_mesh.height = 0.25
	var pad_mat: StandardMaterial3D = StandardMaterial3D.new()
	pad_mat.albedo_color = Color(0.32, 0.36, 0.42) # Cured aerospace concrete
	pad_mat.roughness = 0.7
	pad_mat.metallic = 0.1

	var pad_inst: MeshInstance3D = MeshInstance3D.new()
	pad_inst.name = "LaunchPad"
	pad_inst.mesh = pad_mesh
	pad_inst.material_override = pad_mat
	pad_inst.position = Vector3(0.0, 0.1, 0.0)
	add_child(pad_inst)

	# High-visibility yellow safety perimeter ring
	var ring_mesh: TorusMesh = TorusMesh.new()
	ring_mesh.inner_radius = 26.5
	ring_mesh.outer_radius = 27.5
	var ring_mat: StandardMaterial3D = StandardMaterial3D.new()
	ring_mat.albedo_color = Color(0.96, 0.82, 0.12) # Caution safety yellow
	ring_mat.roughness = 0.4
	var ring_inst: MeshInstance3D = MeshInstance3D.new()
	ring_inst.mesh = ring_mesh
	ring_inst.material_override = ring_mat
	ring_inst.position = Vector3(0.0, 0.24, 0.0)
	add_child(ring_inst)

	# Center launch cross target
	var cross_mat: StandardMaterial3D = StandardMaterial3D.new()
	cross_mat.albedo_color = Color(0.95, 0.95, 0.98) # White markings
	for rot in [0.0, 90.0]:
		var bar_mesh: BoxMesh = BoxMesh.new()
		bar_mesh.size = Vector3(2.0, 0.02, 24.0)
		var bar_inst: MeshInstance3D = MeshInstance3D.new()
		bar_inst.mesh = bar_mesh
		bar_inst.material_override = cross_mat
		bar_inst.rotation_degrees = Vector3(0.0, rot, 0.0)
		bar_inst.position = Vector3(0.0, 0.23, 0.0)
		add_child(bar_inst)

	# Compass direction markings on ground
	var label_n: Label3D = _create_ground_label("N [000°]", Vector3(0.0, 0.3, -38.0), Color(0.35, 0.85, 1.0))
	var label_e: Label3D = _create_ground_label("E [090°]", Vector3(38.0, 0.3, 0.0), Color(0.35, 0.85, 1.0))
	var label_s: Label3D = _create_ground_label("S [180°]", Vector3(0.0, 0.3, 38.0), Color(0.35, 0.85, 1.0))
	var label_w: Label3D = _create_ground_label("W [270°]", Vector3(-38.0, 0.3, 0.0), Color(0.35, 0.85, 1.0))
	add_child(label_n)
	add_child(label_e)
	add_child(label_s)
	add_child(label_w)

func _build_distance_rings() -> void:
	var ring_distances: Array[float] = [500.0, 1000.0, 2000.0, 3000.0]
	var ring_mat: StandardMaterial3D = StandardMaterial3D.new()
	ring_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	ring_mat.albedo_color = Color(0.25, 0.35, 0.45, 0.4)
	ring_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA

	for dist in ring_distances:
		var torus: TorusMesh = TorusMesh.new()
		torus.inner_radius = dist - 1.5
		torus.outer_radius = dist + 1.5
		torus.rings = 64
		torus.ring_segments = 4

		var r_inst: MeshInstance3D = MeshInstance3D.new()
		r_inst.mesh = torus
		r_inst.material_override = ring_mat
		r_inst.position = Vector3(0.0, 0.15, 0.0)
		add_child(r_inst)

		var dist_lbl: Label3D = _create_ground_label("%0.0f m RANGE" % dist, Vector3(dist, 0.3, 0.0), Color(0.5, 0.65, 0.8, 0.7))
		add_child(dist_lbl)

func _create_ground_label(text: String, pos: Vector3, col: Color) -> Label3D:
	var lbl: Label3D = Label3D.new()
	lbl.text = text
	lbl.position = pos
	lbl.rotation_degrees = Vector3(-90.0, 0.0, 0.0) # Flat on ground
	lbl.font_size = 32
	lbl.modulate = col
	lbl.outline_size = 4
	lbl.outline_modulate = Color(0.05, 0.05, 0.08, 0.9)
	return lbl
