class_name MissionControlUI
extends Control

## Professional scientific mission control interface for autonomous 4-BLDC balloon operations.
## High-contrast telemetry ribbon, dedicated propulsion docks, embedded 2D schematic,
## floating lifecycle controls, and engineering visualization overlay toggles.

signal scenario_selected(scenario_index: int)
signal mode_selected(mode_index: int)
signal sim_speed_changed(speed: float)
signal pause_toggled()
signal step_requested()
signal reset_requested()
signal launch_requested()
signal camera_mode_requested(cam_mode: int)
signal camera_reset_requested()
signal external_ai_toggled(enabled: bool, url: String)
signal wind_params_changed(speed: float, direction_deg: float, turbulence: float)
signal sensor_noise_toggled(enabled: bool)
signal waypoint_changed(new_waypoint: Vector3)
signal manual_motor_test_toggled(enabled: bool)
signal manual_throttle_changed(motor_index: int, throttle: float)
signal motor_fault_toggled(motor_id: int, is_failed: bool)
signal overlay_toggled(overlay_name: String, enabled: bool)

# Top Ribbon
var lbl_met: Label
var lbl_phase: Label
var lbl_altitude: Label
var lbl_vvi: Label
var lbl_speed: Label
var lbl_heading: Label
var lbl_wind: Label
var lbl_battery: Label
var lbl_gnss: Label
var lbl_ai_status: Label

# Left Dock (Avionics & 4-BLDC Motors)
var left_panel: PanelContainer
var lbl_coords: Label
var lbl_atmosphere: Label
var lbl_attitude: Label
var lbl_motors_summary: Label
var lbl_balloon_specs: Label
var motor_cards: Array[Dictionary] = [] # M1..M4 UI cards

# Right Dock (Navigation & Controls)
var right_panel: PanelContainer
var lbl_nav_mode: Label
var lbl_route_status: Label
var lbl_target_dist: Label
var lbl_target_bearing: Label
var lbl_ai_action: Label
var lbl_external_ai_status: Label

var motor_layout_view: MotorLayoutView

# Controls
var btn_launch: Button
var btn_pause: Button
var btn_step: Button
var btn_reset: Button
var opt_scenarios: OptionButton
var btn_mode_auto: Button
var btn_mode_station: Button
var btn_mode_manual: Button
var btn_mode_passive: Button

var slider_wind_speed: HSlider
var lbl_wind_speed_val: Label
var slider_wind_dir: HSlider
var lbl_wind_dir_val: Label
var slider_turb: HSlider
var lbl_turb_val: Label
var chk_sensor_noise: CheckBox
var chk_external_ai: CheckBox
var txt_ai_url: LineEdit

# Manual motor sliders
var manual_test_panel: VBoxContainer
var manual_sliders: Array[HSlider] = []
var manual_slider_labels: Array[Label] = []

# Engineering Overlays Checkboxes
var chk_overlay_thrust: CheckBox
var chk_overlay_forecast: CheckBox
var chk_overlay_wind: CheckBox
var chk_overlay_grid: CheckBox
var lbl_event_ticker: Label

var _is_layout_built: bool = false

func _init() -> void:
	if not _is_layout_built:
		_build_ui_layout()
		_is_layout_built = true

func _ready() -> void:
	if not _is_layout_built:
		_build_ui_layout()
		_is_layout_built = true

func _build_ui_layout() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

	# 1. Top Telemetry Ribbon
	_build_top_ribbon()

	# 2. Left Telemetry Dock (Avionics + 4 BLDC Motors)
	_build_left_dock()

	# 3. Right Mission Control Dock (Guidance + Motor Layout Schematic + Scenarios)
	_build_right_dock()

	# 4. Floating Bottom Mission Toolbar
	_build_bottom_ribbon()

func _create_panel_style(bg: Color, border: Color, radius: int = 6) -> StyleBoxFlat:
	var style: StyleBoxFlat = StyleBoxFlat.new()
	style.bg_color = bg
	style.border_width_left = 1
	style.border_width_top = 1
	style.border_width_right = 1
	style.border_width_bottom = 1
	style.border_color = border
	style.corner_radius_top_left = radius
	style.corner_radius_top_right = radius
	style.corner_radius_bottom_left = radius
	style.corner_radius_bottom_right = radius
	style.content_margin_left = 10
	style.content_margin_right = 10
	style.content_margin_top = 8
	style.content_margin_bottom = 8
	return style

func _build_top_ribbon() -> void:
	var top_bar: PanelContainer = PanelContainer.new()
	top_bar.name = "TopRibbon"
	top_bar.mouse_filter = Control.MOUSE_FILTER_STOP
	var top_style: StyleBoxFlat = StyleBoxFlat.new()
	top_style.bg_color = Color(0.07, 0.09, 0.13, 0.96)
	top_style.border_width_bottom = 2
	top_style.border_color = Color(0.24, 0.35, 0.48)
	top_style.content_margin_left = 18
	top_style.content_margin_right = 18
	top_style.content_margin_top = 6
	top_style.content_margin_bottom = 6
	top_bar.add_theme_stylebox_override("panel", top_style)
	top_bar.set_anchors_preset(Control.PRESET_TOP_WIDE)
	add_child(top_bar)

	var top_hbox: HBoxContainer = HBoxContainer.new()
	top_hbox.add_theme_constant_override("separation", 22)
	top_bar.add_child(top_hbox)

	# Identity & MET
	var title_vbox: VBoxContainer = VBoxContainer.new()
	title_vbox.add_theme_constant_override("separation", 1)
	var app_lbl: Label = Label.new()
	app_lbl.text = "AERODRIFT // 4-BLDC STRATO-NAV"
	app_lbl.add_theme_color_override("font_color", Color(0.38, 0.85, 1.0))
	app_lbl.add_theme_font_size_override("font_size", 13)
	title_vbox.add_child(app_lbl)

	lbl_met = Label.new()
	lbl_met.text = "MET: 00:00:00.0"
	lbl_met.add_theme_color_override("font_color", Color(1.0, 1.0, 1.0))
	lbl_met.add_theme_font_size_override("font_size", 15)
	title_vbox.add_child(lbl_met)
	top_hbox.add_child(title_vbox)

	# Phase Badge
	lbl_phase = Label.new()
	lbl_phase.text = "[PRE-LAUNCH]"
	lbl_phase.add_theme_color_override("font_color", Color(0.30, 0.92, 0.45))
	lbl_phase.add_theme_font_size_override("font_size", 13)
	top_hbox.add_child(lbl_phase)

	# Altitude & VVI
	var alt_vbox: VBoxContainer = VBoxContainer.new()
	alt_vbox.add_theme_constant_override("separation", 1)
	lbl_altitude = Label.new()
	lbl_altitude.text = "ALT: 5.0 m MSL"
	lbl_altitude.add_theme_color_override("font_color", Color(0.95, 0.96, 0.98))
	lbl_altitude.add_theme_font_size_override("font_size", 13)
	alt_vbox.add_child(lbl_altitude)
	lbl_vvi = Label.new()
	lbl_vvi.text = "VVI: +0.0 m/s"
	lbl_vvi.add_theme_color_override("font_color", Color(0.30, 0.92, 0.45))
	lbl_vvi.add_theme_font_size_override("font_size", 12)
	alt_vbox.add_child(lbl_vvi)
	top_hbox.add_child(alt_vbox)

	# Ground Speed & Heading
	var spd_vbox: VBoxContainer = VBoxContainer.new()
	spd_vbox.add_theme_constant_override("separation", 1)
	lbl_speed = Label.new()
	lbl_speed.text = "GS: 0.0 m/s"
	lbl_speed.add_theme_color_override("font_color", Color(0.95, 0.96, 0.98))
	lbl_speed.add_theme_font_size_override("font_size", 13)
	spd_vbox.add_child(lbl_speed)
	lbl_heading = Label.new()
	lbl_heading.text = "TRK: 000°"
	lbl_heading.add_theme_color_override("font_color", Color(0.72, 0.78, 0.88))
	lbl_heading.add_theme_font_size_override("font_size", 12)
	spd_vbox.add_child(lbl_heading)
	top_hbox.add_child(spd_vbox)

	# Wind
	lbl_wind = Label.new()
	lbl_wind.text = "WIND: 8.0 m/s @ 065°"
	lbl_wind.add_theme_color_override("font_color", Color(0.85, 0.90, 0.96))
	lbl_wind.add_theme_font_size_override("font_size", 13)
	top_hbox.add_child(lbl_wind)

	# Battery
	lbl_battery = Label.new()
	lbl_battery.text = "BATT: 100.0% [16.8V]"
	lbl_battery.add_theme_color_override("font_color", Color(0.30, 0.92, 0.45))
	lbl_battery.add_theme_font_size_override("font_size", 13)
	top_hbox.add_child(lbl_battery)

	# GNSS
	lbl_gnss = Label.new()
	lbl_gnss.text = "GNSS: 12 SATS (HDOP 0.9)"
	lbl_gnss.add_theme_color_override("font_color", Color(0.88, 0.92, 0.96))
	lbl_gnss.add_theme_font_size_override("font_size", 13)
	top_hbox.add_child(lbl_gnss)

	# AI Status
	lbl_ai_status = Label.new()
	lbl_ai_status.text = "EDGE-AI: 95% [NOMINAL]"
	lbl_ai_status.add_theme_color_override("font_color", Color(0.38, 0.85, 1.0))
	lbl_ai_status.add_theme_font_size_override("font_size", 13)
	top_hbox.add_child(lbl_ai_status)

func _build_left_dock() -> void:
	left_panel = PanelContainer.new()
	left_panel.name = "LeftDock"
	left_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	left_panel.add_theme_stylebox_override("panel", _create_panel_style(Color(0.07, 0.09, 0.13, 0.94), Color(0.22, 0.30, 0.42)))

	left_panel.anchor_left = 0.0
	left_panel.anchor_top = 0.062
	left_panel.anchor_bottom = 0.925
	left_panel.offset_left = 12.0
	left_panel.offset_right = 312.0 # 300px width
	add_child(left_panel)

	var scroll: ScrollContainer = ScrollContainer.new()
	left_panel.add_child(scroll)

	var vbox: VBoxContainer = VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 10)
	scroll.add_child(vbox)

	# Subsystem Title
	var t1: Label = Label.new()
	t1.text = "4-BLDC PROPULSION TELEMETRY"
	t1.add_theme_color_override("font_color", Color(0.38, 0.85, 1.0))
	t1.add_theme_font_size_override("font_size", 13)
	vbox.add_child(t1)

	lbl_motors_summary = Label.new()
	lbl_motors_summary.text = "NET THRUST: 0.00 N | POWER: 10.0 W"
	lbl_motors_summary.add_theme_color_override("font_color", Color(0.85, 0.90, 0.95))
	lbl_motors_summary.add_theme_font_size_override("font_size", 12)
	vbox.add_child(lbl_motors_summary)

	# 4 Individual Motor Cards (M1, M2, M3, M4)
	for i in range(4):
		var card_panel: PanelContainer = PanelContainer.new()
		var card_style: StyleBoxFlat = StyleBoxFlat.new()
		card_style.bg_color = Color(0.10, 0.13, 0.18, 0.90)
		card_style.border_width_left = 4
		card_style.border_width_top = 1
		card_style.border_width_right = 1
		card_style.border_width_bottom = 1
		card_style.border_color = Color(0.25, 0.90, 0.45)
		card_style.corner_radius_top_left = 4
		card_style.corner_radius_top_right = 4
		card_style.corner_radius_bottom_left = 4
		card_style.corner_radius_bottom_right = 4
		card_style.content_margin_left = 8
		card_style.content_margin_top = 6
		card_style.content_margin_right = 8
		card_style.content_margin_bottom = 6
		card_panel.add_theme_stylebox_override("panel", card_style)

		var card_vbox: VBoxContainer = VBoxContainer.new()
		card_vbox.add_theme_constant_override("separation", 3)

		var m_header: Label = Label.new()
		m_header.text = "MOTOR M%d (%s)" % [i + 1, "CW" if (i % 2 == 0) else "CCW"]
		m_header.add_theme_color_override("font_color", Color(0.30, 0.92, 0.45))
		m_header.add_theme_font_size_override("font_size", 12)
		card_vbox.add_child(m_header)

		var m_detail: Label = Label.new()
		m_detail.text = "RPM: 0 (0%) | Thrust: 0.0 N\nPower: 2.5 W | ESC: 24.0°C\nStatus: HEALTHY"
		m_detail.add_theme_color_override("font_color", Color(0.90, 0.92, 0.95))
		m_detail.add_theme_font_size_override("font_size", 11)
		card_vbox.add_child(m_detail)

		# Cutoff fault toggle button
		var fault_btn: Button = Button.new()
		fault_btn.text = "Simulate M%d Cutoff" % (i + 1)
		fault_btn.toggled.connect(func(pressed): motor_fault_toggled.emit(i + 1, pressed))
		fault_btn.toggle_mode = true
		card_vbox.add_child(fault_btn)

		card_panel.add_child(card_vbox)
		vbox.add_child(card_panel)

		motor_cards.append({
			"panel": card_panel,
			"style": card_style,
			"header": m_header,
			"detail": m_detail,
			"fault_btn": fault_btn
		})

	# Avionics & Dynamics Section
	var t2: Label = Label.new()
	t2.text = "FLIGHT AVIONICS & SENSORS"
	t2.add_theme_color_override("font_color", Color(0.38, 0.85, 1.0))
	t2.add_theme_font_size_override("font_size", 13)
	vbox.add_child(t2)

	lbl_coords = Label.new()
	lbl_coords.text = "LOCAL POSITION:\nX: +0.0 m | Y: +5.0 m | Z: +0.0 m"
	lbl_coords.add_theme_color_override("font_color", Color(0.90, 0.92, 0.95))
	lbl_coords.add_theme_font_size_override("font_size", 11)
	vbox.add_child(lbl_coords)

	lbl_atmosphere = Label.new()
	lbl_atmosphere.text = "ATMOSPHERE (ISA):\nDensity: 1.225 kg/m³ | Temp: +15.0 °C"
	lbl_atmosphere.add_theme_color_override("font_color", Color(0.90, 0.92, 0.95))
	lbl_atmosphere.add_theme_font_size_override("font_size", 11)
	vbox.add_child(lbl_atmosphere)

	lbl_attitude = Label.new()
	lbl_attitude.text = "FRAME ATTITUDE:\nPitch: 0.0° | Roll: 0.0° | Yaw: 000°"
	lbl_attitude.add_theme_color_override("font_color", Color(0.90, 0.92, 0.95))
	lbl_attitude.add_theme_font_size_override("font_size", 11)
	vbox.add_child(lbl_attitude)

	# Balloon Envelope Lift Inspection
	var t3: Label = Label.new()
	t3.text = "BALLOON LIFT & MASS BALANCE"
	t3.add_theme_color_override("font_color", Color(0.38, 0.85, 1.0))
	t3.add_theme_font_size_override("font_size", 13)
	vbox.add_child(t3)

	lbl_balloon_specs = Label.new()
	lbl_balloon_specs.text = "ENVELOPE: 4.0m Dia x 5.0m H | 41.9 m³\nGROSS LIFT: 504.6 N | TOTAL MASS: 25.6 kg\nNET SYSTEM BUOYANCY: +198.5 N FREE LIFT"
	lbl_balloon_specs.add_theme_color_override("font_color", Color(0.85, 0.90, 0.95))
	lbl_balloon_specs.add_theme_font_size_override("font_size", 11)
	vbox.add_child(lbl_balloon_specs)

func _build_right_dock() -> void:
	right_panel = PanelContainer.new()
	right_panel.name = "RightDock"
	right_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	right_panel.add_theme_stylebox_override("panel", _create_panel_style(Color(0.07, 0.09, 0.13, 0.94), Color(0.22, 0.30, 0.42)))

	right_panel.anchor_left = 1.0
	right_panel.anchor_right = 1.0
	right_panel.anchor_top = 0.062
	right_panel.anchor_bottom = 0.925
	right_panel.offset_left = -332.0 # 320px width
	right_panel.offset_right = -12.0
	add_child(right_panel)

	var scroll: ScrollContainer = ScrollContainer.new()
	right_panel.add_child(scroll)

	var vbox: VBoxContainer = VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 10)
	scroll.add_child(vbox)

	# 1. Navigation Guidance Mode
	var nav_title: Label = Label.new()
	nav_title.text = "EDGE-AI NAVIGATION CONTROLLER"
	nav_title.add_theme_color_override("font_color", Color(0.38, 0.85, 1.0))
	nav_title.add_theme_font_size_override("font_size", 13)
	vbox.add_child(nav_title)

	lbl_nav_mode = Label.new()
	lbl_nav_mode.text = "MODE: AUTONOMOUS 4-BLDC WAYPOINT"
	lbl_nav_mode.add_theme_color_override("font_color", Color(0.98, 0.80, 0.20))
	lbl_nav_mode.add_theme_font_size_override("font_size", 12)
	vbox.add_child(lbl_nav_mode)

	# Mode Selection Buttons
	var mode_grid: GridContainer = GridContainer.new()
	mode_grid.columns = 2
	mode_grid.add_theme_constant_override("h_separation", 6)
	mode_grid.add_theme_constant_override("v_separation", 4)

	btn_mode_auto = Button.new()
	btn_mode_auto.text = "Auto Waypoints"
	btn_mode_auto.pressed.connect(func(): mode_selected.emit(0))
	mode_grid.add_child(btn_mode_auto)

	btn_mode_station = Button.new()
	btn_mode_station.text = "Station Keep"
	btn_mode_station.pressed.connect(func(): mode_selected.emit(1))
	mode_grid.add_child(btn_mode_station)

	btn_mode_manual = Button.new()
	btn_mode_manual.text = "Manual Test"
	btn_mode_manual.pressed.connect(func(): mode_selected.emit(2))
	mode_grid.add_child(btn_mode_manual)

	btn_mode_passive = Button.new()
	btn_mode_passive.text = "Passive Drift"
	btn_mode_passive.pressed.connect(func(): mode_selected.emit(3))
	mode_grid.add_child(btn_mode_passive)

	vbox.add_child(mode_grid)

	# Waypoint Telemetry
	lbl_route_status = Label.new()
	lbl_route_status.text = "ROUTE: WP 1 / 3 [Active]"
	lbl_route_status.add_theme_color_override("font_color", Color(0.92, 0.94, 0.98))
	lbl_route_status.add_theme_font_size_override("font_size", 12)
	vbox.add_child(lbl_route_status)

	lbl_target_dist = Label.new()
	lbl_target_dist.text = "TARGET DIST: 450 m | BRG: 045°"
	lbl_target_dist.add_theme_color_override("font_color", Color(0.85, 0.90, 0.95))
	lbl_target_dist.add_theme_font_size_override("font_size", 11)
	vbox.add_child(lbl_target_dist)

	lbl_ai_action = Label.new()
	lbl_ai_action.text = "ACTION: 4 motors counteracting wind drift"
	lbl_ai_action.autowrap_mode = TextServer.AUTOWRAP_WORD
	lbl_ai_action.add_theme_color_override("font_color", Color(0.75, 0.85, 0.95))
	lbl_ai_action.add_theme_font_size_override("font_size", 11)
	vbox.add_child(lbl_ai_action)

	# 2. Embedded Top-Down Motor Layout Schematic
	motor_layout_view = MotorLayoutView.new()
	vbox.add_child(motor_layout_view)

	# 3. Manual Motor Test Sliders (Visible in manual mode)
	manual_test_panel = VBoxContainer.new()
	manual_test_panel.add_theme_constant_override("separation", 4)
	manual_test_panel.visible = false

	var m_test_lbl: Label = Label.new()
	m_test_lbl.text = "MANUAL MOTOR THROTTLES (-100% to +100%):"
	m_test_lbl.add_theme_color_override("font_color", Color(0.98, 0.80, 0.20))
	m_test_lbl.add_theme_font_size_override("font_size", 11)
	manual_test_panel.add_child(m_test_lbl)

	for i in range(4):
		var s_box: HBoxContainer = HBoxContainer.new()
		var s_name: Label = Label.new()
		s_name.text = "M%d:" % (i + 1)
		s_name.custom_minimum_size = Vector2(30, 0)
		s_name.add_theme_color_override("font_color", Color(0.9, 0.92, 0.95))
		s_box.add_child(s_name)

		var slider: HSlider = HSlider.new()
		slider.min_value = -1.0
		slider.max_value = 1.0
		slider.step = 0.05
		slider.value = 0.0
		slider.custom_minimum_size = Vector2(170, 0)
		slider.value_changed.connect(func(v): _on_manual_slider_changed(i, v))
		s_box.add_child(slider)
		manual_sliders.append(slider)

		var s_val: Label = Label.new()
		s_val.text = "0%"
		s_val.add_theme_color_override("font_color", Color(0.9, 0.92, 0.95))
		s_box.add_child(s_val)
		manual_slider_labels.append(s_val)

		manual_test_panel.add_child(s_box)

	vbox.add_child(manual_test_panel)

	# 4. 10 Repeatable Test Scenarios
	var sc_title: Label = Label.new()
	sc_title.text = "TEST SCENARIOS (10 PROFILES)"
	sc_title.add_theme_color_override("font_color", Color(0.38, 0.85, 1.0))
	sc_title.add_theme_font_size_override("font_size", 13)
	vbox.add_child(sc_title)

	opt_scenarios = OptionButton.new()
	opt_scenarios.add_item("1. Calm-Air Ascent", 0)
	opt_scenarios.add_item("2. Crosswind Drift Test", 1)
	opt_scenarios.add_item("3. Strong Wind Motor Correction", 2)
	opt_scenarios.add_item("4. Gust Disturbance & Recovery", 3)
	opt_scenarios.add_item("5. Wind-Direction Reversal", 4)
	opt_scenarios.add_item("6. Multi-Waypoint Navigation Route", 5)
	opt_scenarios.add_item("7. Battery Depletion", 6)
	opt_scenarios.add_item("8. One-Motor Failure (M1 Cutoff)", 7)
	opt_scenarios.add_item("9. Sensor Noise & GNSS Dropout", 8)
	opt_scenarios.add_item("10. External AI Service Disconnect", 9)
	opt_scenarios.select(5)
	opt_scenarios.item_selected.connect(func(idx): scenario_selected.emit(idx))
	vbox.add_child(opt_scenarios)

	# 5. Wind & Environment Controls
	var env_title: Label = Label.new()
	env_title.text = "WIND ENVIRONMENT CONTROLS"
	env_title.add_theme_color_override("font_color", Color(0.38, 0.85, 1.0))
	env_title.add_theme_font_size_override("font_size", 13)
	vbox.add_child(env_title)

	var w_spd_box: HBoxContainer = HBoxContainer.new()
	var w_lbl: Label = Label.new()
	w_lbl.text = "Wind Speed:"
	w_lbl.add_theme_color_override("font_color", Color(0.9, 0.92, 0.95))
	w_spd_box.add_child(w_lbl)
	lbl_wind_speed_val = Label.new()
	lbl_wind_speed_val.text = "8.0 m/s"
	lbl_wind_speed_val.add_theme_color_override("font_color", Color(0.38, 0.85, 1.0))
	w_spd_box.add_child(lbl_wind_speed_val)
	vbox.add_child(w_spd_box)

	slider_wind_speed = HSlider.new()
	slider_wind_speed.min_value = 0.0
	slider_wind_speed.max_value = 25.0
	slider_wind_speed.step = 0.5
	slider_wind_speed.value = 8.0
	slider_wind_speed.value_changed.connect(_on_wind_slider_changed)
	vbox.add_child(slider_wind_speed)

	var w_dir_box: HBoxContainer = HBoxContainer.new()
	var d_lbl: Label = Label.new()
	d_lbl.text = "Wind Direction:"
	d_lbl.add_theme_color_override("font_color", Color(0.9, 0.92, 0.95))
	w_dir_box.add_child(d_lbl)
	lbl_wind_dir_val = Label.new()
	lbl_wind_dir_val.text = "065°"
	lbl_wind_dir_val.add_theme_color_override("font_color", Color(0.38, 0.85, 1.0))
	w_dir_box.add_child(lbl_wind_dir_val)
	vbox.add_child(w_dir_box)

	slider_wind_dir = HSlider.new()
	slider_wind_dir.min_value = 0.0
	slider_wind_dir.max_value = 360.0
	slider_wind_dir.step = 5.0
	slider_wind_dir.value = 65.0
	slider_wind_dir.value_changed.connect(_on_wind_slider_changed)
	vbox.add_child(slider_wind_dir)

	var turb_box: HBoxContainer = HBoxContainer.new()
	var t_lbl: Label = Label.new()
	t_lbl.text = "Turbulence Gusts:"
	turb_box.add_child(t_lbl)
	lbl_turb_val = Label.new()
	lbl_turb_val.text = "0.20"
	lbl_turb_val.add_theme_color_override("font_color", Color(0.38, 0.85, 1.0))
	turb_box.add_child(lbl_turb_val)
	vbox.add_child(turb_box)

	slider_turb = HSlider.new()
	slider_turb.min_value = 0.0
	slider_turb.max_value = 1.0
	slider_turb.step = 0.05
	slider_turb.value = 0.20
	slider_turb.value_changed.connect(_on_wind_slider_changed)
	vbox.add_child(slider_turb)

	chk_sensor_noise = CheckBox.new()
	chk_sensor_noise.text = "Sensor Noise & Uncertainty"
	chk_sensor_noise.button_pressed = true
	chk_sensor_noise.toggled.connect(func(pressed): sensor_noise_toggled.emit(pressed))
	vbox.add_child(chk_sensor_noise)

	# External AI inference
	var ext_title: Label = Label.new()
	ext_title.text = "EXTERNAL PYTHON AI"
	ext_title.add_theme_color_override("font_color", Color(0.38, 0.85, 1.0))
	ext_title.add_theme_font_size_override("font_size", 13)
	vbox.add_child(ext_title)

	chk_external_ai = CheckBox.new()
	chk_external_ai.text = "Enable Python HTTP Server"
	chk_external_ai.button_pressed = false
	chk_external_ai.toggled.connect(func(pressed): external_ai_toggled.emit(pressed, txt_ai_url.text))
	vbox.add_child(chk_external_ai)

	txt_ai_url = LineEdit.new()
	txt_ai_url.text = "http://127.0.0.1:8000/predict"
	vbox.add_child(txt_ai_url)

	lbl_external_ai_status = Label.new()
	lbl_external_ai_status.text = "Local Baseline Active (Python Offline)"
	lbl_external_ai_status.add_theme_color_override("font_color", Color(0.70, 0.75, 0.82))
	lbl_external_ai_status.add_theme_font_size_override("font_size", 11)
	vbox.add_child(lbl_external_ai_status)

func _build_bottom_ribbon() -> void:
	# Floating bottom mission toolbar between left and right docks
	var bot_bar: PanelContainer = PanelContainer.new()
	bot_bar.name = "FloatingMissionBar"
	bot_bar.mouse_filter = Control.MOUSE_FILTER_STOP
	var b_style: StyleBoxFlat = StyleBoxFlat.new()
	b_style.bg_color = Color(0.07, 0.09, 0.13, 0.94)
	b_style.border_width_left = 1
	b_style.border_width_top = 1
	b_style.border_width_right = 1
	b_style.border_width_bottom = 1
	b_style.border_color = Color(0.24, 0.35, 0.48)
	b_style.corner_radius_top_left = 8
	b_style.corner_radius_top_right = 8
	b_style.corner_radius_bottom_left = 8
	b_style.corner_radius_bottom_right = 8
	b_style.content_margin_left = 14
	b_style.content_margin_right = 14
	b_style.content_margin_top = 6
	b_style.content_margin_bottom = 6
	bot_bar.add_theme_stylebox_override("panel", b_style)

	bot_bar.anchor_left = 0.21
	bot_bar.anchor_right = 0.79
	bot_bar.anchor_top = 1.0
	bot_bar.anchor_bottom = 1.0
	bot_bar.offset_top = -54.0
	bot_bar.offset_bottom = -10.0
	add_child(bot_bar)

	var hbox: HBoxContainer = HBoxContainer.new()
	hbox.add_theme_constant_override("separation", 10)
	bot_bar.add_child(hbox)

	btn_launch = Button.new()
	btn_launch.text = "▶ LAUNCH"
	btn_launch.pressed.connect(func(): launch_requested.emit())
	hbox.add_child(btn_launch)

	btn_pause = Button.new()
	btn_pause.text = "⏸ PAUSE"
	btn_pause.pressed.connect(func(): pause_toggled.emit())
	hbox.add_child(btn_pause)

	btn_step = Button.new()
	btn_step.text = "⏯ STEP"
	btn_step.pressed.connect(func(): step_requested.emit())
	hbox.add_child(btn_step)

	btn_reset = Button.new()
	btn_reset.text = "↺ RESET"
	btn_reset.pressed.connect(func(): reset_requested.emit())
	hbox.add_child(btn_reset)

	# Sim Speeds
	var spd_lbl: Label = Label.new()
	spd_lbl.text = "Speed:"
	spd_lbl.add_theme_color_override("font_color", Color(0.70, 0.78, 0.88))
	hbox.add_child(spd_lbl)

	var speeds: Array[float] = [1.0, 2.0, 5.0, 10.0]
	for spd in speeds:
		var b: Button = Button.new()
		b.text = "%dx" % int(spd)
		b.pressed.connect(func(): sim_speed_changed.emit(spd))
		hbox.add_child(b)

	hbox.add_spacer(false)

	# Camera Mode buttons
	var cam_lbl: Label = Label.new()
	cam_lbl.text = "Camera:"
	cam_lbl.add_theme_color_override("font_color", Color(0.70, 0.78, 0.88))
	hbox.add_child(cam_lbl)

	var b_orb: Button = Button.new()
	b_orb.text = "Orbit (1)"
	b_orb.pressed.connect(func(): camera_mode_requested.emit(0))
	hbox.add_child(b_orb)

	var b_chase: Button = Button.new()
	b_chase.text = "Chase (2)"
	b_chase.pressed.connect(func(): camera_mode_requested.emit(1))
	hbox.add_child(b_chase)

	var b_mot: Button = Button.new()
	b_mot.text = "Motors (3)"
	b_mot.pressed.connect(func(): camera_mode_requested.emit(2))
	hbox.add_child(b_mot)

	var b_top: Button = Button.new()
	b_top.text = "Top-Down (5)"
	b_top.pressed.connect(func(): camera_mode_requested.emit(4))
	hbox.add_child(b_top)

	var b_rst_cam: Button = Button.new()
	b_rst_cam.text = "Reset Cam (R)"
	b_rst_cam.pressed.connect(func(): camera_reset_requested.emit())
	hbox.add_child(b_rst_cam)

func _on_manual_slider_changed(motor_idx: int, val: float) -> void:
	if motor_idx < manual_slider_labels.size():
		manual_slider_labels[motor_idx].text = "%0.0f%%" % (val * 100.0)
	manual_throttle_changed.emit(motor_idx, val)

func _on_wind_slider_changed(_val: float) -> void:
	var spd: float = slider_wind_speed.value
	var dir: float = slider_wind_dir.value
	var turb: float = slider_turb.value

	lbl_wind_speed_val.text = "%0.1f m/s" % spd
	lbl_wind_dir_val.text = "%0.0f°" % dir
	lbl_turb_val.text = "%0.2f" % turb
	wind_params_changed.emit(spd, dir, turb)

## Updates live telemetry from flight state, state estimator, motor frame, and planner.
func update_telemetry(
	ground_truth: Dictionary,
	est_state: Dictionary,
	nav_output: Dictionary,
	motor_telemetry: Array,
	allocation_data: Dictionary,
	phase_name: String,
	met_sec: float
) -> void:
	if lbl_met == null:
		return

	# Format MET
	var mins: int = int(met_sec / 60.0)
	var secs: int = int(met_sec) % 60
	var tenths: int = int((met_sec - floor(met_sec)) * 10.0)
	lbl_met.text = "MET: %02d:%02d:%02d.%d" % [mins / 60, mins % 60, secs, tenths]

	lbl_phase.text = "[%s]" % phase_name

	var alt: float = est_state.get("altitude", 0.0)
	lbl_altitude.text = "ALT: %0.1f m MSL" % alt

	var vel: Vector3 = est_state.get("velocity", Vector3.ZERO)
	var vvi: float = vel.y
	lbl_vvi.text = "VVI: %s%0.1f m/s" % ["+" if vvi >= 0.0 else "", vvi]
	if vvi > 0.2:
		lbl_vvi.add_theme_color_override("font_color", Color(0.30, 0.92, 0.45))
	elif vvi < -0.2:
		lbl_vvi.add_theme_color_override("font_color", Color(1.0, 0.40, 0.20))
	else:
		lbl_vvi.add_theme_color_override("font_color", Color(0.38, 0.85, 1.0))

	var gs: float = Vector2(vel.x, vel.z).length()
	var trk: float = est_state.get("heading_deg", 0.0)
	lbl_speed.text = "GS: %0.1f m/s" % gs
	lbl_heading.text = "TRK: %03.0f°" % trk

	var wind_v: Vector3 = est_state.get("wind_velocity", Vector3.ZERO)
	var w_spd: float = Vector2(wind_v.x, wind_v.z).length()
	var w_brg: float = fposmod(rad_to_deg(atan2(wind_v.x, -wind_v.z)), 360.0)
	lbl_wind.text = "WIND: %0.1f m/s @ %03.0f°" % [w_spd, w_brg]

	var b_pct: float = est_state.get("battery_percent", 100.0)
	var b_volt: float = est_state.get("battery_voltage", 16.8)
	lbl_battery.text = "BATT: %0.1f%% [%0.1fV]" % [b_pct, b_volt]

	var conf: float = nav_output.get("confidence", 0.95) * 100.0
	var is_gnss_drop: bool = est_state.get("is_gnss_dropout", false)
	if is_gnss_drop:
		lbl_gnss.text = "GNSS: DROPOUT (Dead Reckoning)"
		lbl_gnss.add_theme_color_override("font_color", Color(1.0, 0.35, 0.25))
	else:
		lbl_gnss.text = "GNSS: 12 SATS (HDOP 0.9)"
		lbl_gnss.add_theme_color_override("font_color", Color(0.88, 0.92, 0.96))

	var stat_msg: String = nav_output.get("planner_status", "NOMINAL")
	lbl_ai_status.text = "EDGE-AI: %0.0f%% [%s]" % [conf, stat_msg]

	# Left Dock Coordinates & Attitude
	var pos: Vector3 = est_state.get("position", Vector3.ZERO)
	lbl_coords.text = "LOCAL POSITION:\nX: %+0.1f m | Y: %+0.1f m | Z: %+0.1f m" % [pos.x, pos.y, pos.z]

	var rho: float = ground_truth.get("air_density", 1.225)
	var temp_c: float = ground_truth.get("air_temp_k", 288.15) - 273.15
	lbl_atmosphere.text = "ATMOSPHERE (ISA):\nDensity: %0.3f kg/m³ | Temp: %+0.1f °C" % [rho, temp_c]

	var pitch: float = est_state.get("pitch_deg", 0.0)
	var roll: float = est_state.get("roll_deg", 0.0)
	var yaw_deg: float = rad_to_deg(ground_truth.get("yaw_rad", 0.0))
	lbl_attitude.text = "FRAME ATTITUDE:\nPitch: %+0.1f° | Roll: %+0.1f° | Yaw: %03.0f°" % [pitch, roll, fposmod(yaw_deg, 360.0)]

	# 4-BLDC Motors Cards Update
	var total_thrust_n: float = 0.0
	var total_power_w: float = 0.0

	for i in range(min(motor_telemetry.size(), motor_cards.size())):
		var m: Dictionary = motor_telemetry[i]
		var rpm: float = m.get("rpm", 0.0)
		var t_n: float = m.get("thrust_n", 0.0)
		var p_w: float = m.get("power_w", 0.0)
		var temp: float = m.get("temp_c", 24.0)
		var healthy: bool = m.get("is_healthy", true)
		total_thrust_n += abs(t_n)
		total_power_w += p_w

		var card: Dictionary = motor_cards[i]
		card.header.text = "MOTOR M%d (%s)" % [i + 1, "CW" if (i % 2 == 0) else "CCW"]
		card.detail.text = "RPM: %0.0f (%0.0f%%) | Thrust: %0.2f N\nPower: %0.1f W | ESC: %0.1f°C\nStatus: %s" % [
			rpm, (abs(rpm) / 7200.0) * 100.0,
			t_n, p_w, temp,
			"HEALTHY" if healthy else "CUTOFF / FAULT"
		]

		if not healthy:
			card.style.border_color = Color(1.0, 0.25, 0.25)
			card.header.add_theme_color_override("font_color", Color(1.0, 0.25, 0.25))
		else:
			card.style.border_color = Color(0.25, 0.90, 0.45)
			card.header.add_theme_color_override("font_color", Color(0.30, 0.92, 0.45))

	lbl_motors_summary.text = "NET THRUST: %0.2f N | TOTAL POWER: %0.1f W" % [total_thrust_n, total_power_w]

	# Right Dock Navigation Readouts
	var n_mode: int = nav_output.get("nav_mode", 0)
	match n_mode:
		0: lbl_nav_mode.text = "MODE: AUTONOMOUS 4-BLDC WAYPOINT"
		1: lbl_nav_mode.text = "MODE: STATION-KEEPING POSITION HOLD"
		2: lbl_nav_mode.text = "MODE: MANUAL MOTOR TEST OVERRIDE"
		3: lbl_nav_mode.text = "MODE: PASSIVE DRIFT (MOTORS OFF)"

	manual_test_panel.visible = (n_mode == 2)

	var wp_idx: int = nav_output.get("waypoint_index", 0) + 1
	var tot_wp: int = nav_output.get("total_waypoints", 3)
	lbl_route_status.text = "ROUTE: WP %d / %d [%0.0f, %0.0f, %0.0f]" % [
		wp_idx, tot_wp,
		nav_output.get("active_waypoint", Vector3.ZERO).x,
		nav_output.get("active_waypoint", Vector3.ZERO).y,
		nav_output.get("active_waypoint", Vector3.ZERO).z
	]

	var d_wp: float = nav_output.get("distance_to_waypoint", 0.0)
	var b_wp: float = nav_output.get("bearing_to_waypoint_deg", 0.0)
	lbl_target_dist.text = "TARGET DIST: %0.0f m | BEARING: %03.0f°" % [d_wp, b_wp]
	lbl_ai_action.text = "DECISION:\n%s" % nav_output.get("planner_action", "")

	# Update Motor Layout 2D Schematic
	if motor_layout_view != null:
		var f_net: Vector3 = Vector3(allocation_data.get("achieved_fx", 0.0), 0.0, allocation_data.get("achieved_fz", 0.0))
		var t_net: Vector3 = Vector3(0.0, allocation_data.get("achieved_tau_y", 0.0), 0.0)
		var is_feas: bool = allocation_data.get("is_feasible", true)
		motor_layout_view.update_layout_state(motor_telemetry, f_net, t_net, is_feas)

func set_external_ai_status(msg: String, online: bool) -> void:
	if lbl_external_ai_status != null:
		lbl_external_ai_status.text = msg
		lbl_external_ai_status.add_theme_color_override("font_color", Color(0.30, 0.92, 0.45) if online else Color(0.95, 0.45, 0.25))
