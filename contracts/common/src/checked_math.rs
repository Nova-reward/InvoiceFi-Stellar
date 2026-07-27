#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CheckedMathError {
    Overflow,
    Underflow,
    DivisionByZero,
}

pub fn checked_add(a: i128, b: i128) -> Result<i128, CheckedMathError> {
    match a.checked_add(b) {
        Some(val) => Ok(val),
        None => {
            if a > 0 && b > 0 {
                Err(CheckedMathError::Overflow)
            } else {
                Err(CheckedMathError::Underflow)
            }
        }
    }
}

pub fn checked_sub(a: i128, b: i128) -> Result<i128, CheckedMathError> {
    match a.checked_sub(b) {
        Some(val) => Ok(val),
        None => {
            if b < 0 {
                Err(CheckedMathError::Overflow)
            } else {
                Err(CheckedMathError::Underflow)
            }
        }
    }
}

pub fn checked_mul(a: i128, b: i128) -> Result<i128, CheckedMathError> {
    match a.checked_mul(b) {
        Some(val) => Ok(val),
        None => {
            if (a > 0 && b > 0) || (a < 0 && b < 0) {
                Err(CheckedMathError::Overflow)
            } else {
                Err(CheckedMathError::Underflow)
            }
        }
    }
}

pub fn checked_div(a: i128, b: i128) -> Result<i128, CheckedMathError> {
    if b == 0 {
        return Err(CheckedMathError::DivisionByZero);
    }
    match a.checked_div(b) {
        Some(val) => Ok(val),
        None => Err(CheckedMathError::Overflow),
    }
}

#[cfg(test)]
mod tests {
    extern crate alloc;
    use alloc::vec;
    use super::*;
    use proptest::prelude::*;

    fn boundary_values() -> impl Strategy<Value = i128> {
        prop_oneof![
            Just(0i128),
            Just(1i128),
            Just(-1i128),
            Just(i64::MAX as i128),
            Just(i64::MIN as i128),
            Just((i64::MAX - 1) as i128),
            Just((i64::MIN + 1) as i128),
            Just(i128::MAX),
            Just(i128::MIN),
            Just(i128::MAX - 1),
            Just(i128::MIN + 1),
            any::<i128>(),
        ]
    }

    proptest! {
        #[test]
        fn test_prop_add(a in boundary_values(), b in boundary_values()) {
            let res = checked_add(a, b);
            let expected = a.checked_add(b);
            match (res, expected) {
                (Ok(v), Some(e)) => assert_eq!(v, e),
                (Err(CheckedMathError::Overflow), None) if a > 0 && b > 0 => {},
                (Err(CheckedMathError::Underflow), None) if a < 0 && b < 0 => {},
                _ => panic!("Mismatch on checked_add({}, {}): res={:?}, expected={:?}", a, b, res, expected),
            }
        }

        #[test]
        fn test_prop_sub(a in boundary_values(), b in boundary_values()) {
            let res = checked_sub(a, b);
            let expected = a.checked_sub(b);
            match (res, expected) {
                (Ok(v), Some(e)) => assert_eq!(v, e),
                (Err(CheckedMathError::Overflow), None) if b < 0 => {},
                (Err(CheckedMathError::Underflow), None) if b >= 0 => {},
                _ => panic!("Mismatch on checked_sub({}, {}): res={:?}, expected={:?}", a, b, res, expected),
            }
        }

        #[test]
        fn test_prop_mul(a in boundary_values(), b in boundary_values()) {
            let res = checked_mul(a, b);
            let expected = a.checked_mul(b);
            match (res, expected) {
                (Ok(v), Some(e)) => assert_eq!(v, e),
                (Err(CheckedMathError::Overflow), None) if (a > 0 && b > 0) || (a < 0 && b < 0) => {},
                (Err(CheckedMathError::Underflow), None) if (a > 0 && b < 0) || (a < 0 && b > 0) => {},
                _ => panic!("Mismatch on checked_mul({}, {}): res={:?}, expected={:?}", a, b, res, expected),
            }
        }

        #[test]
        fn test_prop_div(a in boundary_values(), b in boundary_values()) {
            let res = checked_div(a, b);
            let expected = a.checked_div(b);
            match (res, expected) {
                (Ok(v), Some(e)) => assert_eq!(v, e),
                (Err(CheckedMathError::DivisionByZero), None) if b == 0 => {},
                (Err(CheckedMathError::Overflow), None) if a == i128::MIN && b == -1 => {},
                _ => panic!("Mismatch on checked_div({}, {}): res={:?}, expected={:?}", a, b, res, expected),
            }
        }
    }
}
