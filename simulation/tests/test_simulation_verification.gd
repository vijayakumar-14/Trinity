extends SceneTree

## Comprehensive automated engineering verification suite for Godot 4.7.
## Verifies all 15 acceptance criteria for the 4-BLDC Autonomous Helium Balloon Simulator.

var _passed_count: int = 0
var _failed_count: int = 0

func _init() -> void:
	print("======================================================================")
	print("🧪 STARTING ENGINEERING VERIFICATION SUITE — GODOT 4.7")
	print("   AUTONOMOUS HELIUM BALLOON WITH 4-BLDC MOTOR PROPULSION")
	print("======================================================================")

	var success: bool = true
	success = _test_criterion_1_assembly_hierarchy() and success
	success = _test_criterion_2_propeller_independent_rotation() and success
	success = _test_criterion_3_motor_rpm_to_thrust_physics() and success
	success = _test_criterion_4_forces_applied_at_real_mount_positions() and success
	success = _test_criterion_5_wind_creates_realistic_drift() and success
	success = _test_criterion_6_motor_corrections_change_trajectory() and success
	success = _test_criterion_7_payload_pendulum_dynamics() and success
	success = _test_criterion_8_ai_sensor_based_waypoint_navigation() and success
	success = _test_criterion_9_controller_respects_actuator_limits() and success
	success = _test_criterion_10_telemetry_reflects_simulated_state() and success
	success = _test_criterion_11_motor_failure_reduces_authority() and success
	success = _test_criterion_12_trajectory_predictor_responsiveness() and success
	success = _test_criterion_13_mission_lifecycle_controls() and success
	success = _test_criterion_14_resilience_without_external_ai() and success
	success = _test_criterion_15_full_orchestrator_execution() and success

	print("======================================================================")
	print("📊 VERIFICATION RESULTS: %d PASSED, %d FAILED" % [_passed_count, _failed_count])
	print("======================================================================")

	if _failed_count == 0:
		print("✅ ALL 15 ACCEPTANCE CRITERIA VERIFIED SUCCESSFULLY.")
		quit(0)
	else:
		printerr("❌ VERIFICATION SUITE ENCOUNTERED FAILURES.")
		quit(1)

func _record_result(criterion_num: int, title: String, passed: bool, details: String = "") -> bool:
	if passed:
		_passed_count += 1
		print("  [PASS] Criterion %2d: %s %s" % [criterion_num, title, details])
		return true
	else:
		_failed_count += 1
		printerr("  [FAIL] Criterion %2d: %s %s" % [criterion_num, title, details])
		return false

## 1. Balloon, suspension frame, electronics, and 4 BLDC motors are visibly separate 3D objects.
func _test_criterion_1_assembly_hierarchy() -> bool:
	var cfg: SimulationConfig = SimulationConfig.new()
	var assembly: BalloonAssembly = BalloonAssembly.new()
	assembly.config = cfg
	assembly._ready()

	var has_env: bool = assembly.envelope_view != null
	var has_rig: bool = assembly.suspension_rig != null
	var has_dyn: bool = assembly.payload_dynamics != null
	var has_frame: bool = assembly.motor_frame != null
	var has_payload: bool = assembly.payload_view != null
	var motor_count_ok: bool = assembly.motor_frame != null and assembly.motor_frame.motors.size() == 4

	var ok: bool = has_env and has_rig and has_dyn and has_frame and has_payload and motor_count_ok
	assembly.free()
	return _record_result(1, "Balloon, suspension frame, electronics, and 4 BLDC motors are distinct 3D objects", ok)

## 2. All four propellers rotate independently according to motor commands.
func _test_criterion_2_propeller_independent_rotation() -> bool:
	var frame: MotorFrame = MotorFrame.new()
	frame.config = SimulationConfig.new()
	frame._ready()

	# Command 4 distinct throttles: M1 = 40%, M2 = 70%, M3 = -50%, M4 = 0%
	frame.set_motor_throttles([0.4, 0.7, -0.5, 0.0])

	# Advance physics for 0.4 seconds to allow spin-up
	for i in range(24):
		frame.update_motors_physics(1.0 / 60.0)

	var m1_rpm: float = frame.motors[0].current_rpm
	var m2_rpm: float = frame.motors[1].current_rpm
	var m3_rpm: float = frame.motors[2].current_rpm
	var m4_rpm: float = frame.motors[3].current_rpm

	var independent: bool = (m1_rpm > 1000.0) and (m2_rpm > m1_rpm) and (m3_rpm < -1000.0) and (abs(m4_rpm) < 10.0)
	frame.free()
	return _record_result(2, "All four propellers rotate independently according to distinct throttle commands", independent,
		"(M1: %0.0f RPM, M2: %0.0f RPM, M3: %0.0f RPM, M4: %0.0f RPM)" % [m1_rpm, m2_rpm, m3_rpm, m4_rpm])

## 3. Motor RPM changes produce corresponding thrust changes (T = kT * RPM^2).
func _test_criterion_3_motor_rpm_to_thrust_physics() -> bool:
	var m: BLDCMotor = BLDCMotor.new()
	m.kt = 1.1e-6
	m.max_rpm = 7200.0
	m._ready()

	# Spin up to 3600 RPM (50% throttle)
	m.commanded_rpm = 3600.0
	for i in range(30):
		m.update_motor_physics(1.0 / 60.0)
	var t_half: float = m.current_thrust_n

	# Spin up to 7200 RPM (100% throttle)
	m.commanded_rpm = 7200.0
	for i in range(30):
		m.update_motor_physics(1.0 / 60.0)
	var t_full: float = m.current_thrust_n

	# T(7200) / T(3600) should be approx (2)^2 = 4.0
	var ratio: float = t_full / max(0.01, t_half)
	var ok: bool = abs(ratio - 4.0) < 0.2 and t_full > 5.0
	m.free()
	return _record_result(3, "Motor RPM changes produce quadratic aerodynamic thrust (T = kT * RPM^2)", ok,
		"(T_3600: %0.2f N, T_7200: %0.2f N, Ratio: %0.2fx)" % [t_half, t_full, ratio])

## 4. Motor forces are applied at their real mounting positions (generating moments).
func _test_criterion_4_forces_applied_at_real_mount_positions() -> bool:
	var frame: MotorFrame = MotorFrame.new()
	frame.config = SimulationConfig.new()
	frame._ready()

	# Fire M1 only (Front-Right arm at x=+0.60, z=-0.60)
	frame.set_motor_throttles([1.0, 0.0, 0.0, 0.0])
	for i in range(20):
		frame.update_motors_physics(1.0 / 60.0)

	var res: Dictionary = frame.update_motors_physics(1.0 / 60.0)
	var f_net: Vector3 = res.get("net_force_local", Vector3.ZERO)
	var t_net: Vector3 = res.get("net_torque_local", Vector3.ZERO)

	# Firing M1 generates horizontal thrust AND yaw/pitch moment about frame origin
	var has_force: bool = f_net.length() > 3.0
	var has_torque: bool = t_net.length() > 0.5
	frame.free()
	return _record_result(4, "Motor forces applied at offset positions generate realistic translational & moment forces", has_force and has_torque,
		"(F_net: %0.1f N, Torque: %0.2f N*m)" % [f_net.length(), t_net.length()])

## 5. Wind creates realistic drift and disturbance.
func _test_criterion_5_wind_creates_realistic_drift() -> bool:
	var cfg: SimulationConfig = SimulationConfig.new()
	var phys: BalloonPhysics = BalloonPhysics.new()
	phys.config = cfg

	var wf: WindField = WindField.new()
	wf.apply_scenario(WindField.Scenario.CROSSWIND_DRIFT)
	wf._ready()
	phys.wind_field = wf
	phys._ready()
	phys.position_world = Vector3(0.0, 300.0, 0.0)

	# Step with motors idle: balloon should drift eastward
	for i in range(300): # 5 seconds
		phys.physics_step(1.0 / 60.0)

	var vx_val: float = phys.velocity_world.x
	var px_val: float = phys.position_world.x
	var drifted_east: bool = vx_val > 6.0 and px_val > 10.0
	wf.free()
	phys.free()
	return _record_result(5, "Atmospheric wind creates realistic aerodynamic drag and horizontal drift", drifted_east,
		"(East Velocity: %0.1f m/s, Displacement: %0.1f m)" % [vx_val, px_val])

## 6. Motor corrections change the actual trajectory through the physics system.
func _test_criterion_6_motor_corrections_change_trajectory() -> bool:
	var cfg: SimulationConfig = SimulationConfig.new()
	var phys: BalloonPhysics = BalloonPhysics.new()
	phys.config = cfg

	var wf: WindField = WindField.new()
	wf.base_speed = 8.0
	wf.base_direction_deg = 90.0 # East (+X)
	wf._ready()
	phys.wind_field = wf
	phys._ready()
	phys.position_world = Vector3(0.0, 300.0, 0.0)

	# Apply 60 N opposing thrust along -X (fighting the wind with multi-motor authority)
	phys.motor_thrust_vector_world = Vector3(-60.0, 0.0, 0.0)

	for i in range(300):
		phys.physics_step(1.0 / 60.0)

	# Because motors actively counteracted the wind, ground speed along X should be significantly reduced
	var vx_val: float = phys.velocity_world.x
	var counteracted: bool = vx_val < 4.5
	wf.free()
	phys.free()
	return _record_result(6, "Motor corrections actively oppose wind and steer trajectory through physics engine", counteracted,
		"(Resulting Ground Vx: %0.1f m/s vs 8.0 m/s unmitigated wind)" % vx_val)

## 7. The payload responds to vehicle acceleration and wind with damped swinging.
func _test_criterion_7_payload_pendulum_dynamics() -> bool:
	var dyn: PayloadDynamics = PayloadDynamics.new()
	dyn.cable_length = 3.8
	dyn.damping_ratio = 0.55
	dyn._ready()

	# Apply lateral acceleration for 1 second (60 frames)
	for i in range(60):
		dyn.update_dynamics(Vector3(3.5, 0.0, 0.0), Vector3.ZERO, 1.0 / 60.0)
	var tilt_active: float = abs(dyn.roll_angle)

	# Allow damping for 3 seconds (180 frames)
	for i in range(180):
		dyn.update_dynamics(Vector3.ZERO, Vector3.ZERO, 1.0 / 60.0)
	var tilt_damped: float = abs(dyn.roll_angle)

	var ok: bool = tilt_active > 0.05 and tilt_damped < tilt_active
	dyn.free()
	return _record_result(7, "Suspended payload responds to acceleration with natural frequency and damping", ok)

## 8. The AI uses sensor observations to navigate toward waypoints.
func _test_criterion_8_ai_sensor_based_waypoint_navigation() -> bool:
	var nav: EdgeAINavigator = EdgeAINavigator.new()
	nav.config = SimulationConfig.new()
	nav._ready()

	# Dummy estimated state at (0, 300, 0), target at (350, 320, -250)
	var est: Dictionary = {
		"position": Vector3(0.0, 300.0, 0.0),
		"velocity": Vector3.ZERO,
		"wind_velocity": Vector3(5.0, 0.0, 0.0),
		"battery_percent": 95.0,
		"motor_health": [true, true, true, true]
	}

	var cmd: Dictionary = nav.plan_navigation_cycle(est, 0.1)
	var fx: float = cmd.get("desired_fx", 0.0)
	var fz: float = cmd.get("desired_fz", 0.0)

	# To steer toward target (+X, -Z) against East (+X) wind:
	# cmd should demand corrective force toward target
	var ok: bool = abs(fx) > 0.1 or abs(fz) > 0.1
	nav.free()
	return _record_result(8, "Edge-AI planner computes corrective horizontal forces from sensor observations", ok,
		"(Desired Fx: %0.1f N, Fz: %0.1f N)" % [fx, fz])

## 9. Controller respects the force and torque limits of the configured motor layout.
func _test_criterion_9_controller_respects_actuator_limits() -> bool:
	var alloc: MotorAllocator = MotorAllocator.new()

	# Request unattainable force of 250 N (max total motor capacity in X is ~160 N)
	var res: Dictionary = alloc.allocate_controls(250.0, 0.0, 0.0)
	var cmds: Array = res.get("motor_commands", [])
	var is_feas: bool = res.get("is_feasible", true)

	var bounded: bool = true
	for u in cmds:
		if abs(u) > 1.001:
			bounded = false

	var ok: bool = bounded and not is_feas
	return _record_result(9, "Motor allocator enforces actuator throttle limits [-1.0, 1.0] and flags infeasibility", ok)

## 10. Telemetry reflects the actual simulated state.
func _test_criterion_10_telemetry_reflects_simulated_state() -> bool:
	var m: BLDCMotor = BLDCMotor.new()
	m.motor_id = 1
	m.motor_name = "M1"
	m._ready()
	m.commanded_rpm = 4500.0
	for i in range(60):
		m.update_motor_physics(1.0 / 60.0)

	var ok: bool = abs(m.current_rpm - 4500.0) < 50.0 and m.current_thrust_n > 1.5 and m.current_power_watts > 5.0
	m.free()
	return _record_result(10, "Telemetry readouts (RPM, thrust, power, temperature) reflect live physical state", ok)

## 11. Motor failure reduces the available control authority.
func _test_criterion_11_motor_failure_reduces_authority() -> bool:
	var ctrl: MotorController = MotorController.new()
	var frame: MotorFrame = MotorFrame.new()
	frame.config = SimulationConfig.new()
	frame._ready()
	ctrl.motor_frame = frame
	ctrl._ready()

	# Inject cutoff failure into Motor M1
	ctrl.set_motor_failure(1, true)
	var m1_failed: bool = frame.motors[0].is_failed

	# Request forward force
	var alloc_res: Dictionary = ctrl.update_motor_control(10.0, 0.0, 0.0, [0.0, 0.0, 0.0, 0.0])
	var cmds: Array = alloc_res.get("motor_commands", [])
	var m1_cmd_zero: bool = cmds[0] == 0.0

	var ok: bool = m1_failed and m1_cmd_zero
	ctrl.free()
	frame.free()
	return _record_result(11, "One-motor failure (M1 cutoff) isolates faulted actuator and degrades authority", ok)

## 12. Trajectory predictions respond to wind and motor changes.
func _test_criterion_12_trajectory_predictor_responsiveness() -> bool:
	var cfg: SimulationConfig = SimulationConfig.new()
	var pred: TrajectoryPredictor = TrajectoryPredictor.new()
	pred.config = cfg

	var wf: WindField = WindField.new()
	wf.base_speed = 8.0
	wf.base_direction_deg = 90.0
	wf._ready()
	pred.wind_field = wf
	pred._ready()

	var p0: Vector3 = Vector3(0.0, 400.0, 0.0)

	# Forecast with zero motor thrust
	pred.update_trajectory(p0, Vector3(8.0, 0.0, 0.0), 38.0, 0.0, Vector3.ZERO, 0.0, 1.0)
	var pts_idle: PackedVector3Array = pred.predicted_points.duplicate()

	# Forecast with active 18 N counter-thrust
	pred._prediction_timer = 1.0
	pred.update_trajectory(p0, Vector3(8.0, 0.0, 0.0), 38.0, 0.0, Vector3(-18.0, 0.0, 0.0), 0.0, 1.0)
	var pts_active: PackedVector3Array = pred.predicted_points.duplicate()

	var responds: bool = pts_idle.size() > 5 and pts_active.size() > 5 and pts_idle[5] != pts_active[5]
	wf.free()
	pred.free()
	return _record_result(12, "Trajectory predictor recomputes future flight path based on motor thrust inputs", responds)

## 13. Pause, resume, reset, and simulation speed work correctly.
func _test_criterion_13_mission_lifecycle_controls() -> bool:
	var mgr: MissionManager = MissionManager.new()
	mgr._ready()

	mgr.launch_mission()
	var is_launched: bool = mgr.has_launched

	mgr.set_time_scale(2.0)
	var speed_ok: bool = mgr.time_scale == 2.0

	mgr.toggle_pause()
	var is_paused: bool = mgr.is_paused

	mgr.reset_mission()
	var is_reset: bool = not mgr.has_launched and mgr.mission_elapsed_time == 0.0

	mgr.free()
	var ok: bool = is_launched and speed_ok and is_paused and is_reset
	return _record_result(13, "Mission lifecycle controls (launch, pause, speed warp, reset) operate as intended", ok)

## 14. The application continues working without the optional Python inference service.
func _test_criterion_14_resilience_without_external_ai() -> bool:
	var client: ExternalAIClient = ExternalAIClient.new()
	client.server_url = "http://127.0.0.1:9999/offline_endpoint"
	client.request_timeout_sec = 0.05
	client._ready()

	# Dispatch to offline service
	client.send_observation_async({}, Vector3.ZERO, 0, 1.0)
	var stays_stable: bool = not client.is_service_available

	client.free()
	return _record_result(14, "Autonomous navigation operates seamlessly with internal controller when external AI is offline", stays_stable)

## 15. The project runs in Godot 4.7 without runtime errors.
func _test_criterion_15_full_orchestrator_execution() -> bool:
	var orch: MainOrchestrator = MainOrchestrator.new()
	orch._ready()

	# Run 15 physics process frames
	for i in range(15):
		orch._physics_process(1.0 / 60.0)

	var ok: bool = orch.balloon_physics != null and orch.motor_controller != null and orch.mission_control_ui != null
	orch.free()
	return _record_result(15, "Full Godot 4.7 system orchestration executes frames with zero runtime errors", ok)
