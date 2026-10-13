class_name MainOrchestrator
extends Node3D

## Master orchestrator coordinating physics, 4-BLDC-motor propulsion,
## three-layer Edge-AI navigation, and mission control interface.

@export var config: SimulationConfig

# Scene Nodes
var balloon_physics: BalloonPhysics
var balloon_assembly: BalloonAssembly
var motor_controller: MotorController
var state_estimator: StateEstimator
var sensor_simulator: SensorSimulator
var edge_ai_navigator: EdgeAINavigator
var external_ai_client: ExternalAIClient

var wind_field: WindField
var wind_visualizer: WindVisualizer
var ground_reference: GroundReference
var trajectory_predictor: TrajectoryPredictor
var trajectory_visualizer: TrajectoryVisualizer
var mission_manager: MissionManager
var mission_control_ui: MissionControlUI
var camera_controller: CameraController

# Caches
var _latest_nav_cmd: Dictionary = {}
var _latest_est_state: Dictionary = {}
var _latest_motor_telemetry: Array = []
var _latest_allocation: Dictionary = {}

func _ready() -> void:
	if config == null:
		config = SimulationConfig.new()

	_setup_environment()
	_setup_subsystems()
	_connect_signals()

func _setup_environment() -> void:
	# 1. Key Light (Sun Light from upper-front over camera shoulder)
	var sun: DirectionalLight3D = DirectionalLight3D.new()
	sun.name = "SunKeyLight"
	sun.rotation_degrees = Vector3(-42.0, -28.0, 0.0)
	sun.light_color = Color(1.0, 0.98, 0.95)
	sun.light_energy = 1.85
	sun.shadow_enabled = true
	sun.shadow_blur = 1.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 120.0
	add_child(sun)

	# 2. Fill Light (Soft upward bounce from below to illuminate payload & motor undersides)
	var fill_light: DirectionalLight3D = DirectionalLight3D.new()
	fill_light.name = "FillBounceLight"
	fill_light.rotation_degrees = Vector3(32.0, -40.0, 0.0)
	fill_light.light_color = Color(0.78, 0.86, 0.98) # Cool atmospheric bounce
	fill_light.light_energy = 0.90
	fill_light.shadow_enabled = false
	add_child(fill_light)

	# 3. Rim / Back Light (Separates envelope curvature and payload silhouette from background)
	var rim_light: DirectionalLight3D = DirectionalLight3D.new()
	rim_light.name = "RimBackLight"
	rim_light.rotation_degrees = Vector3(-25.0, 150.0, 0.0)
	rim_light.light_color = Color(0.88, 0.94, 1.0)
	rim_light.light_energy = 0.95
	rim_light.shadow_enabled = false
	add_child(rim_light)

	# 4. World Environment with ACES tonemapping and scientific procedural sky
	var world_env: WorldEnvironment = WorldEnvironment.new()
	world_env.name = "WorldEnv"
	var env: Environment = Environment.new()
	env.background_mode = Environment.BG_SKY

	var sky: Sky = Sky.new()
	var sky_mat: ProceduralSkyMaterial = ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.12, 0.26, 0.45) # Deep slate-blue upper atmosphere
	sky_mat.sky_horizon_color = Color(0.60, 0.72, 0.84) # Luminous horizon gradient
	sky_mat.ground_horizon_color = Color(0.38, 0.46, 0.54)
	sky_mat.ground_bottom_color = Color(0.20, 0.24, 0.28) # Upward ground bounce
	sky_mat.sun_angle_max = 28.0
	sky.sky_material = sky_mat
	env.sky = sky

	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_sky_contribution = 0.65
	env.ambient_light_color = Color(0.88, 0.92, 0.98)
	env.ambient_light_energy = 0.85

	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.18
	env.tonemap_white = 5.5

	# Screen-space ambient occlusion for rich contact shadows on payload & motor mounts
	env.ssao_enabled = true
	env.ssao_radius = 1.4
	env.ssao_intensity = 2.0

	# Subtle bloom for specular highlights on metallic hardware
	env.glow_enabled = true
	env.glow_intensity = 0.08
	env.glow_bloom = 0.01
	env.glow_hdr_threshold = 1.15

	world_env.environment = env
	add_child(world_env)

func _setup_subsystems() -> void:
	ground_reference = GroundReference.new()
	ground_reference.name = "GroundReference"
	add_child(ground_reference)

	wind_field = WindField.new()
	wind_field.name = "WindField"
	add_child(wind_field)

	wind_visualizer = WindVisualizer.new()
	wind_visualizer.name = "WindVisualizer"
	wind_visualizer.wind_field = wind_field
	add_child(wind_visualizer)

	# Balloon Physics Root
	balloon_physics = BalloonPhysics.new()
	balloon_physics.name = "BalloonPhysics"
	balloon_physics.config = config
	balloon_physics.wind_field = wind_field
	add_child(balloon_physics)

	# Assembly with Envelope, Suspension, MotorFrame (4 BLDC motors) and Payload
	balloon_assembly = BalloonAssembly.new()
	balloon_assembly.name = "BalloonAssembly"
	balloon_assembly.config = config
	balloon_physics.add_child(balloon_assembly)

	# Layer C: Motor Controller
	motor_controller = MotorController.new()
	motor_controller.name = "MotorController"
	motor_controller.config = config
	motor_controller.motor_frame = balloon_assembly.motor_frame
	add_child(motor_controller)

	# Sensors & Layer A: State Estimator
	sensor_simulator = SensorSimulator.new()
	sensor_simulator.name = "SensorSimulator"
	sensor_simulator.config = config
	add_child(sensor_simulator)

	state_estimator = StateEstimator.new()
	state_estimator.name = "StateEstimator"
	state_estimator.config = config
	add_child(state_estimator)

	# Layer B: Edge-AI Navigation Planner
	edge_ai_navigator = EdgeAINavigator.new()
	edge_ai_navigator.name = "EdgeAINavigator"
	edge_ai_navigator.config = config
	add_child(edge_ai_navigator)

	# External AI Client
	external_ai_client = ExternalAIClient.new()
	external_ai_client.name = "ExternalAIClient"
	add_child(external_ai_client)

	# Trajectory Forecasting & Visualizer
	trajectory_predictor = TrajectoryPredictor.new()
	trajectory_predictor.name = "TrajectoryPredictor"
	trajectory_predictor.config = config
	trajectory_predictor.wind_field = wind_field
	add_child(trajectory_predictor)

	trajectory_visualizer = TrajectoryVisualizer.new()
	trajectory_visualizer.name = "TrajectoryVisualizer"
	add_child(trajectory_visualizer)
	trajectory_visualizer.setup_waypoints(config.mission_waypoints)

	mission_manager = MissionManager.new()
	mission_manager.name = "MissionManager"
	add_child(mission_manager)

	camera_controller = CameraController.new()
	camera_controller.name = "CameraController"
	camera_controller.target_node = balloon_physics
	camera_controller.payload_node = balloon_assembly.motor_frame
	add_child(camera_controller)

	mission_control_ui = MissionControlUI.new()
	mission_control_ui.name = "MissionControlUI"
	add_child(mission_control_ui)

func _connect_signals() -> void:
	trajectory_predictor.prediction_updated.connect(trajectory_visualizer.update_tracks)

	# UI Actions
	mission_control_ui.launch_requested.connect(_on_launch_requested)
	mission_control_ui.pause_toggled.connect(mission_manager.toggle_pause)
	mission_control_ui.step_requested.connect(mission_manager.step_single_frame)
	mission_control_ui.reset_requested.connect(_on_reset_requested)
	mission_control_ui.sim_speed_changed.connect(mission_manager.set_time_scale)
	mission_control_ui.scenario_selected.connect(_on_scenario_selected)
	mission_control_ui.mode_selected.connect(_on_mode_selected)
	mission_control_ui.camera_mode_requested.connect(camera_controller.set_mode)
	mission_control_ui.camera_reset_requested.connect(camera_controller.reset_camera)
	mission_control_ui.wind_params_changed.connect(_on_wind_params_changed)
	mission_control_ui.sensor_noise_toggled.connect(func(e): sensor_simulator.noise_enabled = e)
	mission_control_ui.external_ai_toggled.connect(_on_external_ai_toggled)
	mission_control_ui.manual_throttle_changed.connect(_on_manual_throttle_changed)
	mission_control_ui.motor_fault_toggled.connect(_on_motor_fault_toggled)

	# External AI
	external_ai_client.prediction_received.connect(_on_external_ai_prediction)
	external_ai_client.connection_status_changed.connect(_on_external_ai_status_changed)

func _physics_process(delta: float) -> void:
	var time_scale: float = mission_manager.time_scale
	var eff_delta: float = delta * time_scale

	if mission_manager.is_paused and not mission_manager.step_requested:
		return

	# Update mission lifecycle
	var dist_to_tgt: float = _latest_nav_cmd.get("distance_to_waypoint", 300.0)
	mission_manager.tick_lifecycle(balloon_physics.position_world.y, balloon_physics.velocity_world.y, dist_to_tgt, eff_delta)

	# 1. Update 4 BLDC Motors and Assembly Dynamics
	var air_rel_v: Vector3 = balloon_physics.air_relative_velocity
	var balloon_a: Vector3 = balloon_physics.acceleration_world
	var motor_frame_result: Dictionary = balloon_assembly.update_assembly(balloon_a, air_rel_v, eff_delta)
	_latest_motor_telemetry = motor_frame_result.get("telemetry", [])

	# Extract net motor force and torque in local frame coordinates
	var f_net_local: Vector3 = motor_frame_result.get("net_force_local", Vector3.ZERO)
	var t_net_local: Vector3 = motor_frame_result.get("net_torque_local", Vector3.ZERO)

	# Convert motor thrust to world coordinates for BalloonPhysics
	# Lower assembly orientation follows balloon yaw + pendulum tilt
	var frame_basis: Basis = balloon_physics.transform.basis
	var f_net_world: Vector3 = frame_basis * f_net_local

	balloon_physics.motor_thrust_vector_world = f_net_world
	balloon_physics.motor_net_torque_nm = t_net_local.y

	# 2. Advance flight physics step
	if mission_manager.has_launched:
		balloon_physics.physics_step(eff_delta)

	# 3. Simulate sensors
	var payload_tilt: Vector3 = balloon_assembly.get_payload_tilt_deg()
	var any_thruster_active: bool = f_net_local.length_squared() > 0.05
	var gt_dict: Dictionary = {
		"position": balloon_physics.position_world,
		"velocity_ground": balloon_physics.velocity_world,
		"wind_velocity": balloon_physics.local_wind_velocity,
		"air_pressure": balloon_physics.current_air_pressure,
		"air_temp_k": balloon_physics.current_air_temp_k,
		"acceleration": balloon_physics.acceleration_world,
		"air_density": balloon_physics.current_air_density,
		"yaw_rad": balloon_physics.current_yaw_rad
	}
	sensor_simulator.update_sensors(gt_dict, payload_tilt, any_thruster_active, eff_delta)
	var raw_sensor_obs: Dictionary = sensor_simulator.get_sensor_observations()

	# 4. Layer A: State Estimation
	_latest_est_state = state_estimator.update_estimator(raw_sensor_obs, _latest_motor_telemetry, eff_delta)

	# 5. Layer B: Autonomous Navigation Planning
	_latest_nav_cmd = edge_ai_navigator.plan_navigation_cycle(_latest_est_state, eff_delta)

	# Apply buoyancy trim
	balloon_physics.buoyancy_trim_force = _latest_nav_cmd.get("desired_buoyancy_trim", 0.0)

	# 6. Layer C: Motor Allocation and Control
	var des_fx: float = _latest_nav_cmd.get("desired_fx", 0.0)
	var des_fz: float = _latest_nav_cmd.get("desired_fz", 0.0)
	var des_tau_y: float = _latest_nav_cmd.get("desired_tau_y", 0.0)
	var man_throttles: Array[float] = _latest_nav_cmd.get("manual_throttles", [0.0, 0.0, 0.0, 0.0])

	_latest_allocation = motor_controller.update_motor_control(des_fx, des_fz, des_tau_y, man_throttles)

	# 7. Trajectory Forecasting & 3D Visuals
	var pred_thrust_v: Vector3 = f_net_world
	trajectory_predictor.update_trajectory(
		balloon_physics.position_world,
		balloon_physics.velocity_world,
		balloon_physics.total_mass_kg,
		balloon_physics.buoyancy_trim_force,
		pred_thrust_v,
		balloon_physics.simulation_time,
		eff_delta
	)

	wind_visualizer.update_wind_flow(balloon_physics.position_world, balloon_physics.simulation_time, eff_delta)

	# 8. Update Mission Control UI
	mission_control_ui.update_telemetry(
		gt_dict,
		_latest_est_state,
		_latest_nav_cmd,
		_latest_motor_telemetry,
		_latest_allocation,
		mission_manager.get_phase_name(),
		mission_manager.mission_elapsed_time
	)

func _on_launch_requested() -> void:
	mission_manager.launch_mission()

func _on_reset_requested() -> void:
	mission_manager.reset_mission()
	balloon_physics.reset_simulation()
	trajectory_predictor.reset_trajectory()

func _on_scenario_selected(idx: int) -> void:
	if wind_field != null:
		wind_field.apply_scenario(idx as WindField.Scenario)

	# Specific scenario setup actions
	match idx:
		1: # Crosswind drift (motors off to demonstrate drift)
			edge_ai_navigator.nav_mode = EdgeAINavigator.NavMode.PASSIVE_DRIFT
		2: # Strong wind requiring active motor corrections
			edge_ai_navigator.nav_mode = EdgeAINavigator.NavMode.AUTONOMOUS_WAYPOINT
		5: # Waypoint navigation
			edge_ai_navigator.nav_mode = EdgeAINavigator.NavMode.AUTONOMOUS_WAYPOINT
		6: # Battery depletion
			sensor_simulator.total_energy_used_wh = config.battery_capacity_wh * 0.96
		7: # One-motor failure (Scenario 8: M1 cutoff)
			motor_controller.set_motor_failure(1, true)
		8: # Sensor noise & GNSS dropout (Scenario 9)
			state_estimator.set_gnss_dropout(true)
		9: # External AI service disconnect (Scenario 10)
			external_ai_client.server_url = "http://127.0.0.1:9999/invalid"
			external_ai_client.send_observation_async({}, Vector3.ZERO, 0, 1.0)

func _on_mode_selected(mode_idx: int) -> void:
	edge_ai_navigator.nav_mode = mode_idx as EdgeAINavigator.NavMode
	motor_controller.is_manual_override = (mode_idx == 2)

func _on_manual_throttle_changed(motor_idx: int, throttle: float) -> void:
	if motor_idx >= 0 and motor_idx < 4:
		edge_ai_navigator.manual_throttles[motor_idx] = throttle

func _on_motor_fault_toggled(motor_id: int, is_failed: bool) -> void:
	motor_controller.set_motor_failure(motor_id, is_failed)

func _on_wind_params_changed(speed: float, dir_deg: float, turb: float) -> void:
	if wind_field != null:
		wind_field.base_speed = speed
		wind_field.base_direction_deg = dir_deg
		wind_field.turbulence_intensity = turb

func _on_external_ai_toggled(enabled: bool, url: String) -> void:
	edge_ai_navigator.use_external_ai = enabled
	external_ai_client.server_url = url
	if not enabled:
		mission_control_ui.set_external_ai_status("Local GDScript Baseline Active", false)

func _on_external_ai_status_changed(connected: bool, message: String) -> void:
	mission_control_ui.set_external_ai_status(message, connected)

func _on_external_ai_prediction(cmd: Dictionary) -> void:
	_latest_nav_cmd["desired_fx"] = cmd.get("desired_fx", 0.0)
	_latest_nav_cmd["desired_fz"] = cmd.get("desired_fz", 0.0)
	_latest_nav_cmd["confidence"] = cmd.get("confidence", 0.95)
	_latest_nav_cmd["planner_status"] = "PYTHON_AI_ONLINE"
	_latest_nav_cmd["planner_action"] = cmd.get("action_summary", "Python Edge-AI neural guidance active")
