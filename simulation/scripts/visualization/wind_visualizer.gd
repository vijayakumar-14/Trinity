class_name WindVisualizer
extends Node3D

## Visualizes 3D atmospheric wind flow fields, particle streaks, and altitude sounding vectors.

@export var wind_field: WindField
@export var num_particles: int = 40
@export var field_radius: float = 35.0

var _particles: Array[Dictionary] = []
var _immediate_mesh: ImmediateMesh
var _mesh_instance: MeshInstance3D
var _material: StandardMaterial3D

func _init() -> void:
	_immediate_mesh = ImmediateMesh.new()
	_init_particles()

func _ready() -> void:
	if _mesh_instance == null:
		_mesh_instance = MeshInstance3D.new()
		_mesh_instance.name = "WindVectorsMesh"
		_mesh_instance.mesh = _immediate_mesh

		_material = StandardMaterial3D.new()
		_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_material.vertex_color_use_as_albedo = true
		_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA

		_mesh_instance.material_override = _material
		add_child(_mesh_instance)

func _init_particles() -> void:
	if not _particles.is_empty():
		return
	var rng: RandomNumberGenerator = RandomNumberGenerator.new()
	rng.seed = 99
	for i in range(num_particles):
		var p_local: Vector3 = Vector3(
			rng.randf_range(-field_radius, field_radius),
			rng.randf_range(-field_radius * 0.6, field_radius * 0.6),
			rng.randf_range(-field_radius, field_radius)
		)
		_particles.append({
			"offset": p_local,
			"age": rng.randf_range(0.0, 2.0),
			"life": rng.randf_range(1.5, 3.0)
		})

## Updates particle streaks around balloon position based on active wind field.
func update_wind_flow(balloon_pos: Vector3, sim_time: float, delta: float) -> void:
	if wind_field == null or delta <= 0.0 or _immediate_mesh == null:
		return

	_immediate_mesh.clear_surfaces()
	_immediate_mesh.surface_begin(Mesh.PRIMITIVE_LINES)

	for p in _particles:
		p.age += delta
		if p.age > p.life:
			p.age = 0.0
			var rng: RandomNumberGenerator = RandomNumberGenerator.new()
			p.offset = Vector3(
				rng.randf_range(-field_radius, field_radius),
				rng.randf_range(-field_radius * 0.6, field_radius * 0.6),
				rng.randf_range(-field_radius, field_radius)
			)

		var world_p: Vector3 = balloon_pos + p.offset
		var wind_v: Vector3 = wind_field.get_wind_velocity(world_p, sim_time)

		# Move particle with wind
		p.offset += wind_v * delta * 0.35
		# Wrap around field boundaries
		if abs(p.offset.x) > field_radius: p.offset.x = -sign(p.offset.x) * field_radius
		if abs(p.offset.z) > field_radius: p.offset.z = -sign(p.offset.z) * field_radius

		# Streak tail
		var speed: float = wind_v.length()
		var tail_len: float = clamp(speed * 0.45, 1.0, 8.0)
		var p_start: Vector3 = world_p
		var p_end: Vector3 = world_p + wind_v.normalized() * tail_len

		# Color based on speed
		var alpha: float = sin((p.age / p.life) * PI) * 0.55
		var col: Color = Color(0.25, 0.75, 1.0, alpha)
		if speed > 15.0:
			col = Color(1.0, 0.45, 0.2, alpha)
		elif speed > 9.0:
			col = Color(0.9, 0.85, 0.3, alpha)

		_immediate_mesh.surface_set_color(col)
		_immediate_mesh.surface_add_vertex(p_start)
		_immediate_mesh.surface_set_color(Color(col.r, col.g, col.b, 0.05))
		_immediate_mesh.surface_add_vertex(p_end)

	_immediate_mesh.surface_end()
