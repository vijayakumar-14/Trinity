class_name EnvelopeView
extends Node3D

## 3D visual representation of the prolate helium balloon envelope, gore seams, and neck collar.

@export var envelope_color: Color = Color(0.95, 0.95, 0.94) # Opaque off-white pearl
@export var seam_color: Color = Color(0.30, 0.34, 0.40, 0.85) # High-contrast structural seams

var _envelope_mesh_instance: MeshInstance3D
var _seams_mesh_instance: MeshInstance3D
var _collar_mesh_instance: MeshInstance3D
var _load_ring_instance: MeshInstance3D
var _apex_valve_instance: MeshInstance3D
var _equatorial_ring_instance: MeshInstance3D
var _equatorial_cleats: Array[Node3D] = []

func _ready() -> void:
	_create_envelope()
	_create_seams()
	_create_equatorial_ring()
	_create_collar_and_ring()
	_create_apex_valve()

func _create_envelope() -> void:
	var mesh: ArrayMesh = BalloonMeshBuilder.build_envelope_mesh(2.0, 1.25, 64, 48)
	_envelope_mesh_instance = MeshInstance3D.new()
	_envelope_mesh_instance.name = "LatexEnvelopeMesh"
	_envelope_mesh_instance.mesh = mesh

	var mat: StandardMaterial3D = StandardMaterial3D.new()
	mat.albedo_color = envelope_color
	mat.roughness = 0.22
	mat.metallic = 0.06
	mat.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED # Opaque volume for front-to-back depth
	mat.clearcoat_enabled = true
	mat.clearcoat = 0.65
	mat.clearcoat_roughness = 0.20
	mat.rim_enabled = true
	mat.rim = 0.60
	mat.rim_tint = 0.30
	mat.subsurf_scatter_enabled = true
	mat.subsurf_scatter_strength = 0.18
	mat.cull_mode = BaseMaterial3D.CULL_BACK

	_envelope_mesh_instance.material_override = mat
	add_child(_envelope_mesh_instance)

func _create_seams() -> void:
	var seams: ArrayMesh = BalloonMeshBuilder.build_seam_lines_mesh(2.012, 1.25, 24)
	_seams_mesh_instance = MeshInstance3D.new()
	_seams_mesh_instance.name = "GoreSeamLines"
	_seams_mesh_instance.mesh = seams

	var seam_mat: StandardMaterial3D = StandardMaterial3D.new()
	seam_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	seam_mat.albedo_color = seam_color
	seam_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA

	_seams_mesh_instance.material_override = seam_mat
	add_child(_seams_mesh_instance)

## Creates the reinforced Upper Equatorial Load Ring at the middle (largest diameter) of the envelope.
## Provides 4 high-strength anchor cleats for the anti-twist suspension system.
func _create_equatorial_ring() -> void:
	var ring_radius: float = 2.015 # Just outside the 2.0m widest diameter
	var ring_mesh: TorusMesh = TorusMesh.new()
	ring_mesh.inner_radius = ring_radius - 0.025
	ring_mesh.outer_radius = ring_radius + 0.025

	var ring_mat: StandardMaterial3D = StandardMaterial3D.new()
	ring_mat.albedo_color = Color(0.22, 0.25, 0.30) # High-modulus carbon-Kevlar girdle
	ring_mat.roughness = 0.35
	ring_mat.metallic = 0.60

	_equatorial_ring_instance = MeshInstance3D.new()
	_equatorial_ring_instance.name = "EquatorialLoadRing"
	_equatorial_ring_instance.mesh = ring_mesh
	_equatorial_ring_instance.material_override = ring_mat
	_equatorial_ring_instance.position = Vector3(0.0, 0.0, 0.0) # Middle / equator of balloon
	add_child(_equatorial_ring_instance)

	# 4 Heavy-duty CNC billet aluminum rigging cleats spaced 90 deg apart at the equator
	# Aligned with the 4 motor axes (315, 45, 135, 225 degrees)
	var cleat_mat: StandardMaterial3D = StandardMaterial3D.new()
	cleat_mat.albedo_color = Color(0.92, 0.50, 0.15) # Safety orange reinforced cleats
	cleat_mat.metallic = 0.85
	cleat_mat.roughness = 0.25

	var angles_deg: Array[float] = [315.0, 45.0, 135.0, 225.0]
	for i in range(4):
		var rad: float = deg_to_rad(angles_deg[i])
		var cleat_node: Node3D = Node3D.new()
		cleat_node.name = "EquatorialCleat_%d" % (i + 1)
		var cx: float = ring_radius * cos(rad)
		var cz: float = ring_radius * sin(rad)
		cleat_node.position = Vector3(cx, 0.0, cz)

		# Cleat body
		var cb_mesh: BoxMesh = BoxMesh.new()
		cb_mesh.size = Vector3(0.08, 0.06, 0.08)
		var cb_inst: MeshInstance3D = MeshInstance3D.new()
		cb_inst.mesh = cb_mesh
		cb_inst.material_override = cleat_mat
		cleat_node.add_child(cb_inst)

		# Heavy-duty load eyelet ring
		var eye_mesh: TorusMesh = TorusMesh.new()
		eye_mesh.inner_radius = 0.018
		eye_mesh.outer_radius = 0.032
		var eye_inst: MeshInstance3D = MeshInstance3D.new()
		eye_inst.mesh = eye_mesh
		eye_inst.material_override = cleat_mat
		eye_inst.position = Vector3(0.0, -0.04, 0.0)
		cleat_node.add_child(eye_inst)

		add_child(cleat_node)
		_equatorial_cleats.append(cleat_node)

func _create_collar_and_ring() -> void:
	# Lower neck collar (safety orange reinforced sleeve)
	var collar_mesh: CylinderMesh = CylinderMesh.new()
	collar_mesh.top_radius = 0.32
	collar_mesh.bottom_radius = 0.24
	collar_mesh.height = 0.38

	var collar_mat: StandardMaterial3D = StandardMaterial3D.new()
	collar_mat.albedo_color = Color(0.94, 0.45, 0.12) # High-visibility aerospace orange
	collar_mat.roughness = 0.4
	collar_mat.metallic = 0.1

	_collar_mesh_instance = MeshInstance3D.new()
	_collar_mesh_instance.name = "NeckCollar"
	_collar_mesh_instance.mesh = collar_mesh
	_collar_mesh_instance.material_override = collar_mat
	_collar_mesh_instance.position = Vector3(0.0, -2.42, 0.0)
	add_child(_collar_mesh_instance)

	# Structural tension bands on collar
	var band_mat: StandardMaterial3D = StandardMaterial3D.new()
	band_mat.albedo_color = Color(0.12, 0.14, 0.16)
	band_mat.roughness = 0.6
	for y_off in [-0.10, 0.10]:
		var band_mesh: TorusMesh = TorusMesh.new()
		band_mesh.inner_radius = 0.27
		band_mesh.outer_radius = 0.29
		var band_inst: MeshInstance3D = MeshInstance3D.new()
		band_inst.mesh = band_mesh
		band_inst.material_override = band_mat
		band_inst.position = Vector3(0.0, -2.42 + y_off, 0.0)
		add_child(band_inst)

	# CNC Aluminum load bridle ring
	var ring_mesh: TorusMesh = TorusMesh.new()
	ring_mesh.inner_radius = 0.28
	ring_mesh.outer_radius = 0.32
	var ring_mat: StandardMaterial3D = StandardMaterial3D.new()
	ring_mat.albedo_color = Color(0.88, 0.88, 0.92)
	ring_mat.metallic = 0.92
	ring_mat.roughness = 0.18

	_load_ring_instance = MeshInstance3D.new()
	_load_ring_instance.name = "LoadDistributionRing"
	_load_ring_instance.mesh = ring_mesh
	_load_ring_instance.material_override = ring_mat
	_load_ring_instance.position = Vector3(0.0, -2.65, 0.0)
	add_child(_load_ring_instance)

func _create_apex_valve() -> void:
	# Apex vent valve crown on top of envelope
	var valve_mesh: CylinderMesh = CylinderMesh.new()
	valve_mesh.top_radius = 0.12
	valve_mesh.bottom_radius = 0.14
	valve_mesh.height = 0.08
	var valve_mat: StandardMaterial3D = StandardMaterial3D.new()
	valve_mat.albedo_color = Color(0.85, 0.25, 0.15) # Apex safety red/orange
	valve_mat.metallic = 0.5
	valve_mat.roughness = 0.3

	_apex_valve_instance = MeshInstance3D.new()
	_apex_valve_instance.name = "ApexVentValve"
	_apex_valve_instance.mesh = valve_mesh
	_apex_valve_instance.material_override = valve_mat
	_apex_valve_instance.position = Vector3(0.0, 2.52, 0.0)
	add_child(_apex_valve_instance)

## Returns the 4 world-space anchor points on the Upper Equatorial Load Ring (widest diameter of envelope).
func get_suspension_anchors() -> Array[Vector3]:
	var anchors: Array[Vector3] = []
	for cleat in _equatorial_cleats:
		if cleat != null and cleat.is_inside_tree():
			anchors.append(cleat.global_position)
		elif cleat != null:
			anchors.append(global_position + cleat.position)
	if anchors.is_empty():
		var r: float = 2.015
		var angles_deg: Array[float] = [315.0, 45.0, 135.0, 225.0]
		for a in angles_deg:
			var rad: float = deg_to_rad(a)
			anchors.append(global_position + Vector3(r * cos(rad), 0.0, r * sin(rad)))
	return anchors
