// Generate a realistic odrive-style telemetry CSV for testing: ~60k rows at
// 1kHz with the canonical column set, a single-sample spike, and some
// constant/dead channels.

const N = 60000;
const cols = [
  "msec", "mot_enc", "pend_enc", "accel_x", "accel_y", "gyro_z",
  "position_est", "velocity_est", "theta_est", "theta_dot_est", "b_theta_est",
  "push", "regulator_output", "mode", "flags", "axis_state", "seq",
  "axis_error", "motor_error", "encoder_error",
];

const lines: string[] = [cols.join(",")];
for (let i = 0; i < N; i++) {
  const t = i; // msec
  const s = i / 1000;
  const theta = 0.15 * Math.sin(s * 2.1) * Math.exp(-s / 40);
  const row = [
    t,
    (s * 3 + 0.02 * Math.sin(s * 7)).toFixed(5), // mot_enc (turns, growing)
    (theta * 1.3 + 0.001 * (Math.random() - 0.5)).toFixed(5), // pend_enc
    (0.02 * Math.sin(s * 9) + (i === 12345 ? 4.0 : 0)).toFixed(5), // accel_x w/ spike
    (9.8 + 0.05 * Math.cos(s * 3)).toFixed(5), // accel_y
    (0.3 * Math.sin(s * 2.1)).toFixed(5), // gyro_z
    (s * 0.5).toFixed(5), // position_est
    (0.5 + 0.1 * Math.cos(s)).toFixed(5), // velocity_est
    theta.toFixed(5), // theta_est
    (0.3 * Math.cos(s * 2.1)).toFixed(5), // theta_dot_est
    (0.01).toFixed(5), // b_theta_est (near-constant)
    (Math.abs(theta) > 0.1 ? 0.2 : 0).toFixed(5), // push
    (-theta * 5).toFixed(5), // regulator_output
    8, // mode (constant enum)
    i % 2000 < 5 ? 2 : 0, // flags (occasional)
    8, // axis_state (constant)
    i & 0xffff, // seq counter
    0, // axis_error (dead)
    0, // motor_error (dead)
    0, // encoder_error (dead)
  ];
  lines.push(row.join(","));
}

await Bun.write("sample/odrive_sample.csv", lines.join("\n"));
console.log(`Wrote sample/odrive_sample.csv (${N} rows, ${cols.length} cols)`);
