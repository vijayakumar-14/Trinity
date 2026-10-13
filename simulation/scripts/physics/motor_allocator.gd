class_name MotorAllocator
extends RefCounted

## Computes the Control Allocation Matrix B and solves for 4-BLDC-motor commands
## using the Moore-Penrose pseudoinverse, with actuator constraints and failure adaptation.

var config: SimulationConfig
var max_thrust_per_motor: float = 5.7 # Newtons

# 3x4 Allocation Matrix B mapping [u1; u2; u3; u4] to [Fx; Fz; Tau_y]
# Rows: 0 = Fx, 1 = Fz, 2 = Tau_y
var B_matrix: Array[Array] = []
var B_pseudoinverse: Array[Array] = [] # 4x3

var is_reversible_esc: bool = true
var failed_motors: Array[bool] = [false, false, false, false]

func _init(cfg: SimulationConfig = null) -> void:
	config = cfg if cfg != null else SimulationConfig.new()
	max_thrust_per_motor = config.motor_kt * (config.motor_max_rpm * config.motor_max_rpm)
	_build_allocation_matrix()

## Builds the 3x4 Control Effectiveness Matrix B based on motor positions and thrust vectors.
func _build_allocation_matrix() -> void:
	B_matrix = [
		[0.0, 0.0, 0.0, 0.0], # Fx
		[0.0, 0.0, 0.0, 0.0], # Fz
		[0.0, 0.0, 0.0, 0.0]  # Tau_y
	]

	for i in range(4):
		if failed_motors[i]:
			continue # Failed motor generates zero control effectiveness

		var t_dir: Vector3 = config.motor_thrust_directions[i]
		var r_pos: Vector3 = config.motor_positions[i]

		# Column i: [T_max * tx; T_max * tz; T_max * (rz*tx - rx*tz)]
		var fx_eff: float = max_thrust_per_motor * t_dir.x
		var fz_eff: float = max_thrust_per_motor * t_dir.z
		# Cross product Y component: (r x t)_y = r.z * t.x - r.x * t.z
		var tau_y_eff: float = max_thrust_per_motor * (r_pos.z * t_dir.x - r_pos.x * t_dir.z)

		B_matrix[0][i] = fx_eff
		B_matrix[1][i] = fz_eff
		B_matrix[2][i] = tau_y_eff

	_compute_pseudoinverse()

## Computes Moore-Penrose pseudoinverse: B^+ = B^T * (B * B^T)^-1
func _compute_pseudoinverse() -> void:
	# 1. Compute 3x3 Gram matrix: G = B * B^T
	var G: Array[Array] = [
		[0.0, 0.0, 0.0],
		[0.0, 0.0, 0.0],
		[0.0, 0.0, 0.0]
	]

	for r in range(3):
		for c in range(3):
			var sum: float = 0.0
			for k in range(4):
				sum += B_matrix[r][k] * B_matrix[c][k]
			G[r][c] = sum
			if r == c:
				# Tikhonov regularization damping for matrix inversion stability
				G[r][c] += 1e-4

	# 2. Invert 3x3 symmetric matrix G
	var G_inv: Array[Array] = _invert_3x3(G)

	# 3. Compute B^+ = B^T * G_inv (4x3 matrix)
	B_pseudoinverse = [
		[0.0, 0.0, 0.0],
		[0.0, 0.0, 0.0],
		[0.0, 0.0, 0.0],
		[0.0, 0.0, 0.0]
	]

	for i in range(4):
		for j in range(3):
			var sum: float = 0.0
			for k in range(3):
				sum += B_matrix[k][i] * G_inv[k][j]
			B_pseudoinverse[i][j] = sum

## Inverts a 3x3 matrix using analytical adjugate and determinant.
func _invert_3x3(A: Array[Array]) -> Array[Array]:
	var a: float = A[0][0]; var b: float = A[0][1]; var c: float = A[0][2]
	var d: float = A[1][0]; var e: float = A[1][1]; var f: float = A[1][2]
	var g: float = A[2][0]; var h: float = A[2][1]; var k: float = A[2][2]

	var det: float = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g)
	if abs(det) < 1e-6:
		det = 1e-6 # Avoid division by zero

	var inv_det: float = 1.0 / det
	var inv: Array[Array] = [
		[(e * k - f * h) * inv_det, (c * h - b * k) * inv_det, (b * f - c * e) * inv_det],
		[(f * g - d * k) * inv_det, (a * k - c * g) * inv_det, (c * d - a * f) * inv_det],
		[(d * h - e * g) * inv_det, (g * b - a * h) * inv_det, (a * e - b * d) * inv_det]
	]
	return inv

## Informs allocator of a motor hardware failure to re-distribute control.
func set_motor_failed(motor_index: int, failed: bool) -> void:
	if motor_index >= 0 and motor_index < 4:
		failed_motors[motor_index] = failed
		_build_allocation_matrix()

## Core API: Allocates desired horizontal forces [Fx, Fz] (N) and yaw torque [Tau_y] (N*m)
## into 4 normalized motor commands [u1, u2, u3, u4] in range [-1.0, 1.0].
func allocate_controls(desired_fx: float, desired_fz: float, desired_tau_y: float) -> Dictionary:
	var v_des: Array[float] = [desired_fx, desired_fz, desired_tau_y]
	var u_cmd: Array[float] = [0.0, 0.0, 0.0, 0.0]

	# Matrix multiplication: u = B^+ * v_des
	for i in range(4):
		if failed_motors[i]:
			u_cmd[i] = 0.0
			continue
		var val: float = B_pseudoinverse[i][0] * v_des[0] + B_pseudoinverse[i][1] * v_des[1] + B_pseudoinverse[i][2] * v_des[2]
		u_cmd[i] = val

	# Clamp to actuator throttle limits
	var min_u: float = -1.0 if is_reversible_esc else 0.0
	var clamped_u: Array[float] = [0.0, 0.0, 0.0, 0.0]
	var max_saturation: float = 1.0

	for i in range(4):
		if failed_motors[i]:
			clamped_u[i] = 0.0
		else:
			clamped_u[i] = clamp(u_cmd[i], min_u, 1.0)
			if abs(u_cmd[i]) > max_saturation:
				max_saturation = abs(u_cmd[i])

	# Compute achieved force & torque: v_achieved = B * clamped_u
	var achieved_fx: float = 0.0
	var achieved_fz: float = 0.0
	var achieved_tau_y: float = 0.0

	for i in range(4):
		achieved_fx += B_matrix[0][i] * clamped_u[i]
		achieved_fz += B_matrix[1][i] * clamped_u[i]
		achieved_tau_y += B_matrix[2][i] * clamped_u[i]

	var err_fx: float = desired_fx - achieved_fx
	var err_fz: float = desired_fz - achieved_fz
	var residual_norm: float = sqrt(err_fx * err_fx + err_fz * err_fz)

	var is_feasible: bool = residual_norm < 1.5 and max_saturation <= 1.05

	return {
		"motor_commands": clamped_u, # [u1, u2, u3, u4]
		"achieved_fx": achieved_fx,
		"achieved_fz": achieved_fz,
		"achieved_tau_y": achieved_tau_y,
		"residual_error": residual_norm,
		"is_feasible": is_feasible,
		"saturation_ratio": max_saturation,
		"failed_motors": failed_motors.duplicate()
	}
