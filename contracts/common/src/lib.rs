#![no_std]
pub mod checked_math;
pub use checked_math::{checked_add, checked_sub, checked_mul, checked_div, CheckedMathError};
