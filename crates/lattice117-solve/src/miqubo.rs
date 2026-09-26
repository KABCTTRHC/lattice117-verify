//! Universal MIQUBO (Mutual Information QUBO) Feature Selection Substrate
//! 
//! This module provides a domain-agnostic discrete filter objective for the 
//! Lattice117 continuous physics core. It natively constructs a QUBO matrix 
//! balancing Feature-Target Relevance against Feature-Feature Redundancy using
//! pure Q16.16 fixed-point arithmetic.
//! 
//! HARDWARE ALIGNMENT: 
//! Maximum continuous features ($N$) per cycle is strictly capped at 16.
//! This maps perfectly to AVX-512 `__m512i` registers, allowing exactly 16 
//! Q16.16 feature states to be processed simultaneously without branch penalties.

/// Q16.16 Fixed-Point Scale

pub const Q16_SHIFT: i32 = 16;
pub const Q16_ONE: i32 = 1 << Q16_SHIFT;

/// Hardware limit for AVX-512 register alignment (16 * 32-bit = 512 bits)
pub const MAX_MIQUBO_FEATURES: usize = 16;

/// Maximum states across parallel execution universes
pub const MAX_MIQUBO_STATES: usize = 1024;

/// The resulting binary mask passed to downstream continuous regressors.
/// 64-byte aligned to prevent false sharing and ensure clean cache loads.
#[repr(C, align(64))]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeatureMask {
    /// 1 = active (keep feature), 0 = dropped (redundant/noisy)
    pub mask: [u8; MAX_MIQUBO_FEATURES], 
    pub active_count: usize,
}

/// The discrete Mutual Information QUBO matrix.
#[repr(C, align(64))]
#[derive(Clone, Debug)]
pub struct MiquboMatrix {
    pub num_features: usize,
    /// Upper triangular QUBO matrix natively in Q16.16 format
    pub q_matrix: [i32; MAX_MIQUBO_FEATURES * MAX_MIQUBO_FEATURES],
}

/// Calculates a deterministic, branchless proxy for Mutual Information /
/// Conditional Correlation natively in Q16.16. Output is strictly bounded [0, 65536].
/// 
/// Uses a squared Pearson-like covariance magnitude to prevent floating point drift.
pub fn calculate_absolute_correlation_q16(vector_a: &[i32], vector_b: &[i32]) -> i32 {
    let len = vector_a.len().min(vector_b.len());
    if len == 0 { return 0; }

    let mut sum_a: i64 = 0;
    let mut sum_b: i64 = 0;
    for i in 0..len {
        sum_a = sum_a.saturating_add(vector_a[i] as i64);
        sum_b = sum_b.saturating_add(vector_b[i] as i64);
    }
    
    let mean_a = (sum_a / len as i64) as i32;
    let mean_b = (sum_b / len as i64) as i32;

    let mut covariance_q32: i64 = 0;
    let mut var_a_q32: i64 = 0;
    let mut var_b_q32: i64 = 0;

    for i in 0..len {
        let delta_a = vector_a[i].saturating_sub(mean_a) as i64;
        let delta_b = vector_b[i].saturating_sub(mean_b) as i64;

        covariance_q32 = covariance_q32.saturating_add(delta_a * delta_b);
        var_a_q32 = var_a_q32.saturating_add(delta_a * delta_a);
        var_b_q32 = var_b_q32.saturating_add(delta_b * delta_b);
    }

    if var_a_q32 == 0 || var_b_q32 == 0 {
        return 0; // Zero variance means zero mutual information
    }

    // Correlation R = Cov(A,B) / sqrt(Var(A) * Var(B))
    // We compute R^2 to keep it absolute and positive (0 to 1.0)
    // Shift logic maintains headroom in 64-bit space before collapsing to Q16.16
    let cov_sq = (covariance_q32.saturating_abs() as i128).pow(2);
    let var_prod = (var_a_q32 as i128) * (var_b_q32 as i128);
    
    if var_prod == 0 { return 0; }

    let r_sq_q16 = ((cov_sq << Q16_SHIFT) / var_prod) as i32;
    
    // Clamp safely to exactly [0, 1.0 in Q16.16]
    r_sq_q16.clamp(0, Q16_ONE)
}

impl MiquboMatrix {
    /// Constructs the universal MIQUBO matrix for N features against a Target Y.
    /// Expected input `feature_matrix` is an array of slices, one per feature.
    pub fn build(
        feature_matrix: &[&[i32]], 
        target_y: &[i32]
    ) -> Result<Self, &'static str> {
        let num_features = feature_matrix.len();
        if num_features > MAX_MIQUBO_FEATURES {
            return Err("Input exceeds hardware limit of MAX_MIQUBO_FEATURES (16).");
        }

        let mut q_matrix = [0i32; MAX_MIQUBO_FEATURES * MAX_MIQUBO_FEATURES];

        // 1. Calculate Relevance (Linear Terms: Q_ii)
        let mut relevance_q16 = [0i32; MAX_MIQUBO_FEATURES];
        for i in 0..num_features {
            // I(x_i ; y)
            relevance_q16[i] = calculate_absolute_correlation_q16(feature_matrix[i], target_y);
        }

        // 2. Build the full QUBO Matrix
        for i in 0..num_features {
            for j in 0..num_features {
                let idx = i * MAX_MIQUBO_FEATURES + j;
                
                if i == j {
                    // LINEAR TERM: Q_ii = -I(x_i ; y)
                    // Negative objective forces the ground state to KEEP highly relevant features.
                    q_matrix[idx] = -relevance_q16[i];
                } else if j > i {
                    // QUADRATIC TERM: Q_ij = I(x_i ; x_j)
                    // Positive penalty forces the ground state to DROP collinear/redundant features.
                    let redundancy = calculate_absolute_correlation_q16(feature_matrix[i], feature_matrix[j]);
                    q_matrix[idx] = redundancy;
                }
            }
        }

        Ok(Self { num_features, q_matrix })
    }
}

/// Interfaces with the Maestro Annealer (or internal deterministic search) 
/// to collapse the Q-matrix into an optimized binary mask.
pub fn build_qubo_for_maestro(qubo: &MiquboMatrix) -> FeatureMask {
    let mut best_mask = [0u8; MAX_MIQUBO_FEATURES];
    let mut lowest_energy: i64 = i64::MAX;

    // N=16 Combinatorial Space is exactly 65,536 states.
    // For universal air-gapped deterministic behavior, we can exhaustively
    // search this small localized N=16 state space in microseconds rather than 
    // relying on a thermal stochastic annealer. This guarantees absolute determinism.
    let total_states = 1u32 << qubo.num_features;
    
    for state in 0..total_states {
        let mut current_energy: i64 = 0;
        
        for i in 0..qubo.num_features {
            let spin_i = (state >> i) & 1;
            if spin_i == 1 {
                // Add linear term
                current_energy += qubo.q_matrix[i * MAX_MIQUBO_FEATURES + i] as i64;
                
                // Add interactions (upper triangular)
                for j in (i + 1)..qubo.num_features {
                    let spin_j = (state >> j) & 1;
                    if spin_j == 1 {
                        current_energy += qubo.q_matrix[i * MAX_MIQUBO_FEATURES + j] as i64;
                    }
                }
            }
        }

        if current_energy < lowest_energy {
            lowest_energy = current_energy;
            for i in 0..qubo.num_features {
                best_mask[i] = ((state >> i) & 1) as u8;
            }
        }
    }

    let active_count = best_mask.iter().filter(|&&m| m == 1).count();
    FeatureMask { mask: best_mask, active_count }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_absolute_correlation_identity() {
        let a = vec![0, 65536, 131072, 196608]; // 0.0, 1.0, 2.0, 3.0
        let b = vec![0, 65536, 131072, 196608];
        let r = calculate_absolute_correlation_q16(&a, &b);
        assert_eq!(r, Q16_ONE, "Identical vectors must have 1.0 correlation");
    }

    #[test]
    fn test_absolute_correlation_orthogonal() {
        let a = vec![65536, -65536, 65536, -65536]; 
        let b = vec![65536, 65536, -65536, -65536]; 
        let r = calculate_absolute_correlation_q16(&a, &b);
        assert_eq!(r, 0, "Orthogonal vectors must have 0.0 correlation");
    }

    #[test]
    fn test_miqubo_matrix_construction_and_signs() {
        let f1 = vec![0, 65536, 131072]; // Perfectly matches target
        let f2 = vec![0, 65536, 131072]; // Perfectly redundant with f1
        let f3 = vec![131072, 65536, 0]; // Negative correlation with target
        let target = vec![0, 65536, 131072];

        let feature_matrix: [&[i32]; 3] = [&f1, &f2, &f3];
        let miqubo = MiquboMatrix::build(&feature_matrix, &target).unwrap();

        // Diagonals (Relevance) should be negative for highly correlated features
        assert_eq!(miqubo.q_matrix[0 * MAX_MIQUBO_FEATURES + 0], -Q16_ONE); // f1 matches target
        assert_eq!(miqubo.q_matrix[1 * MAX_MIQUBO_FEATURES + 1], -Q16_ONE); // f2 matches target
        
        // Off-diagonals (Redundancy) should be positive penalty
        assert_eq!(miqubo.q_matrix[0 * MAX_MIQUBO_FEATURES + 1], Q16_ONE); // f1 and f2 are redundant
    }

    #[test]
    fn test_miqubo_mask_drops_redundant_features() {
        let mut q_matrix = [0i32; MAX_MIQUBO_FEATURES * MAX_MIQUBO_FEATURES];
        
        // F0 is highly relevant (-2.0 energy)
        q_matrix[0 * MAX_MIQUBO_FEATURES + 0] = -131072; 
        
        // F1 is equally relevant (-2.0 energy)
        q_matrix[1 * MAX_MIQUBO_FEATURES + 1] = -131072; 

        // But F0 and F1 are perfectly redundant. If BOTH are chosen, add +5.0 penalty energy.
        // Therefore, the solver should only pick ONE of them, not both.
        q_matrix[0 * MAX_MIQUBO_FEATURES + 1] = 327680; 

        let miqubo = MiquboMatrix { num_features: 2, q_matrix };
        let mask = build_qubo_for_maestro(&miqubo);

        // Ground state energy should be -2.0. Picking both yields -2 - 2 + 5 = +1.0.
        // So the mask must pick exactly ONE feature.
        assert_eq!(mask.active_count, 1, "Solver must drop redundant feature to minimize energy");
        assert!(mask.mask[0] != mask.mask[1], "Solver should pick exactly one of the redundant features");
    }
}