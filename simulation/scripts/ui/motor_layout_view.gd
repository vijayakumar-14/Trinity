class_name MotorLayoutView
extends PanelContainer

## Top-down 2D schematic overlay visualizing the 4-BLDC-motor layout,
## thrust vectors, propeller spin directions, and resulting net force and torque.

var _draw_area: Control
var config: SimulationConfig

var motor_data: Array = []
var net_force_local: Vector3 = Vector3.ZERO
var net_torque_local: Vector3 = Vector3.ZERO
var is_feasible: bool = true

func _ready() -> void:
	if config == null:
		config = SimulationConfig.new()

	mouse_filter = Control.MOUSE_FILTER_PASS
	var style: StyleBoxFlat = StyleBoxFlat.new()
	style.bg_color = Color(0.06, 0.08, 0.11, 0.92)
	style.border_width_left = 1
	style.border_width_top = 1
	style.border_width_right = 1
	style.border_width_bottom = 1
	style.border_color = Color(0.2, 0.28, 0.38)
	style.corner_radius_top_left = 6
	style.corner_radius_top_right = 6
	style.corner_radius_bottom_left = 6
	style.corner_radius_bottom_right = 6
	style.content_margin_left = 12
	style.content_margin_top = 12
	style.content_margin_right = 12
	style.content_margin_bottom = 12
	add_theme_stylebox_override("panel", style)

	custom_minimum_size = Vector2(280.0, 290.0)

	var vbox: VBoxContainer = VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	add_child(vbox)

	var title: Label = Label.new()
	title.text = "TOP-DOWN MOTOR LAYOUT (X-Z)"
	title.add_theme_color_override("font_color", Color(0.35, 0.75, 1.0))
	title.add_theme_font_size_override("font_size", 12)
	vbox.add_child(title)

	_draw_area = Control.new()
	_draw_area.custom_minimum_size = Vector2(256.0, 220.0)
	_draw_area.draw.connect(_on_draw_area_draw)
	vbox.add_child(_draw_area)

func update_layout_state(m_data: Array, f_net: Vector3, t_net: Vector3, feasible: bool) -> void:
	motor_data = m_data
	net_force_local = f_net
	net_torque_local = t_net
	is_feasible = feasible
	if _draw_area != null:
		_draw_area.queue_redraw()

func _on_draw_area_draw() -> void:
	var center: Vector2 = _draw_area.size * 0.5
	var scale_px: float = 85.0 # pixels per meter

	# 1. Background Grid & Range Ring
	_draw_area.draw_circle(center, 0.85 * scale_px, Color(0.15, 0.20, 0.25, 0.5))
	_draw_area.draw_arc(center, 0.85 * scale_px, 0.0, 2.0 * PI, 32, Color(0.25, 0.35, 0.45, 0.6), 1.0)

	# Crosshair axes
	_draw_area.draw_line(Vector2(center.x, 10.0), Vector2(center.x, _draw_area.size.y - 10.0), Color(0.2, 0.25, 0.3, 0.6), 1.0)
	_draw_area.draw_line(Vector2(10.0, center.y), Vector2(_draw_area.size.x - 10.0, center.y), Color(0.2, 0.25, 0.3, 0.6), 1.0)

	# Center of Mass (CM) marker
	_draw_area.draw_circle(center, 4.0, Color(1.0, 0.8, 0.2))
	_draw_area.draw_string(ThemeDB.fallback_font, center + Vector2(6.0, -6.0), "CM", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(0.7, 0.75, 0.8))

	# 2. Draw 4 Frame Arms and Motors
	var positions: Array[Vector3] = config.motor_positions if config != null else [
		Vector3(0.60, 0.0, -0.60), Vector3(0.60, 0.0, 0.60),
		Vector3(-0.60, 0.0, 0.60), Vector3(-0.60, 0.0, -0.60)
	]

	for i in range(4):
		var pos_3d: Vector3 = positions[i]
		# 2D screen coordinates: X is right, Z is down/back (screen Y)
		var m_screen: Vector2 = center + Vector2(pos_3d.x * scale_px, pos_3d.z * scale_px)

		# Draw structural arm line
		_draw_area.draw_line(center, m_screen, Color(0.35, 0.40, 0.48), 2.0)

		# Motor pod circle
		var is_healthy: bool = true
		var thrust_n: float = 0.0
		if i < motor_data.size():
			is_healthy = motor_data[i].get("is_healthy", true)
			thrust_n = motor_data[i].get("thrust_n", 0.0)

		var pod_color: Color = Color(0.2, 0.85, 0.4) if is_healthy else Color(0.95, 0.25, 0.25)
		_draw_area.draw_circle(m_screen, 9.0, pod_color)

		# Motor ID label & spin direction
		var spin_cw: bool = config.motor_spin_directions[i] > 0 if config != null else (i % 2 == 0)
		var lbl_txt: String = "M%d (%s)" % [i + 1, "CW" if spin_cw else "CCW"]
		_draw_area.draw_string(ThemeDB.fallback_font, m_screen + Vector2(-18.0, 18.0), lbl_txt, HORIZONTAL_ALIGNMENT_CENTER, -1, 10, Color(0.85, 0.9, 0.95))

		# Thrust Vector Arrow
		var t_dir_3d: Vector3 = config.motor_thrust_directions[i] if config != null else Vector3.ZERO
		var t_screen_dir: Vector2 = Vector2(t_dir_3d.x, t_dir_3d.z).normalized()
		var arrow_len: float = clamp(abs(thrust_n) * 3.5, 6.0, 26.0)
		var arrow_end: Vector2 = m_screen + t_screen_dir * arrow_len * (sign(thrust_n) if thrust_n != 0.0 else 1.0)
		_draw_area.draw_line(m_screen, arrow_end, Color(0.2, 0.75, 1.0, 0.9), 2.0)

	# 3. Resulting Net Force Vector (Cyan Arrow from Center)
	var f_screen: Vector2 = Vector2(net_force_local.x, net_force_local.z)
	if f_screen.length() > 0.2:
		var net_len: float = clamp(f_screen.length() * 2.2, 10.0, 45.0)
		var f_end: Vector2 = center + f_screen.normalized() * net_len
		_draw_area.draw_line(center, f_end, Color(0.1, 0.95, 0.9, 0.95), 3.0)
		_draw_area.draw_circle(f_end, 3.5, Color(0.1, 0.95, 0.9))

	# 4. Resulting Net Torque Indicator (Ring Arc with direction)
	if abs(net_torque_local.y) > 0.02:
		var torque_col: Color = Color(0.98, 0.75, 0.15, 0.8)
		var start_a: float = 0.0
		var end_a: float = clamp(net_torque_local.y * 3.0, -PI, PI)
		_draw_area.draw_arc(center, 22.0, start_a, end_a, 16, torque_col, 2.0)

	# 5. Live Force & Torque Summary
	var f_mag: float = Vector2(net_force_local.x, net_force_local.z).length()
	var summary_txt: String = "F_net: %0.1f N | Tau: %+0.2f N*m | %s" % [
		f_mag, net_torque_local.y,
		"FEASIBLE" if is_feasible else "SATURATED"
	]
	var col_stat: Color = Color(0.3, 0.85, 0.4) if is_feasible else Color(0.98, 0.75, 0.15)
	_draw_area.draw_string(ThemeDB.fallback_font, Vector2(6.0, _draw_area.size.y - 6.0), summary_txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 10, col_stat)
