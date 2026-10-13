class_name BalloonMeshBuilder
extends RefCounted

## Procedural geometry builder for research balloon envelope, seams, collar, and avionics components.

## Generates a smooth prolate teardrop envelope with vertical meridian seams and neck collar.
static func build_envelope_mesh(radius: float = 2.0, vertical_scale: float = 1.25, segments_h: int = 64, segments_v: int = 48) -> ArrayMesh:
	var surface_tool: SurfaceTool = SurfaceTool.new()
	surface_tool.begin(Mesh.PRIMITIVE_TRIANGLES)

	for lat in range(segments_v + 1):
		var theta: float = (float(lat) * PI) / float(segments_v) # 0 to PI
		var sin_theta: float = sin(theta)
		var cos_theta: float = cos(theta)

		# Teardrop neck taper at bottom (lat near segments_v)
		var v_ratio: float = float(lat) / float(segments_v)
		var neck_taper: float = 1.0 - 0.32 * pow(v_ratio, 2.8)

		for lon in range(segments_h + 1):
			var phi: float = (float(lon) * 2.0 * PI) / float(segments_h)
			var x: float = radius * sin_theta * cos(phi) * neck_taper
			var z: float = radius * sin_theta * sin(phi) * neck_taper
			# Y is up in Godot
			var y: float = radius * cos_theta * vertical_scale

			# Analytical smooth normal
			var norm: Vector3 = Vector3(x, (y / (vertical_scale * vertical_scale)), z).normalized()
			var u: float = float(lon) / float(segments_h)
			var v: float = float(lat) / float(segments_v)

			surface_tool.set_normal(norm)
			surface_tool.set_uv(Vector2(u, v))
			surface_tool.add_vertex(Vector3(x, y, z))

	for lat in range(segments_v):
		for lon in range(segments_h):
			var first: int = lat * (segments_h + 1) + lon
			var second: int = first + (segments_h + 1)

			surface_tool.add_index(first)
			surface_tool.add_index(first + 1)
			surface_tool.add_index(second)

			surface_tool.add_index(second)
			surface_tool.add_index(first + 1)
			surface_tool.add_index(second + 1)

	surface_tool.generate_normals()
	surface_tool.generate_tangents()
	return surface_tool.commit()

## Generates 3D vertical gore seam lines and structural reinforcing equator band.
static func build_seam_lines_mesh(radius: float = 2.015, vertical_scale: float = 1.25, num_seams: int = 24) -> ArrayMesh:
	var surface_tool: SurfaceTool = SurfaceTool.new()
	surface_tool.begin(Mesh.PRIMITIVE_LINES)

	# 1. Vertical meridian gore seams
	for s in range(num_seams):
		var phi: float = (float(s) * 2.0 * PI) / float(num_seams)
		var points: Array[Vector3] = []
		var segs: int = 36

		for lat in range(segs + 1):
			var theta: float = (float(lat) * PI) / float(segs)
			var v_ratio: float = float(lat) / float(segs)
			var neck_taper: float = 1.0 - 0.32 * pow(v_ratio, 2.8)
			var x: float = radius * sin(theta) * cos(phi) * neck_taper
			var z: float = radius * sin(theta) * sin(phi) * neck_taper
			var y: float = radius * cos(theta) * vertical_scale
			points.append(Vector3(x, y, z))

		for i in range(points.size() - 1):
			surface_tool.add_vertex(points[i])
			surface_tool.add_vertex(points[i + 1])

	# 2. Equator structural reinforcing tape band
	var eq_segs: int = 48
	for i in range(eq_segs):
		var phi1: float = (float(i) * 2.0 * PI) / float(eq_segs)
		var phi2: float = (float(i + 1) * 2.0 * PI) / float(eq_segs)
		var p1: Vector3 = Vector3(radius * cos(phi1), 0.0, radius * sin(phi1))
		var p2: Vector3 = Vector3(radius * cos(phi2), 0.0, radius * sin(phi2))
		surface_tool.add_vertex(p1)
		surface_tool.add_vertex(p2)

	return surface_tool.commit()
