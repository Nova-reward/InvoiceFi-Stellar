# Accessibility (WCAG 2.1 AA) Implementation Guide

This document outlines the accessibility improvements made to the InvoiceFi-Stellar application to achieve WCAG 2.1 Level AA compliance.

## Overview

InvoiceFi-Stellar contains financial data tables and multi-step invoice creation forms. This guide documents all accessibility features implemented, testing methodologies used, and remediation steps taken for violations.

## Testing Methodology

### Automated Testing
- **Tool**: axe-core for automated accessibility violation detection
- **Integration**: Jest-based testing framework with `jest-axe`
- **CI/CD**: Automated tests run on every pull request via GitHub Actions
- **Threshold**: Tests fail on any Level A or Level AA violations

### Manual Testing
- **Screen Reader**: NVDA (Windows) and Chrome Vox
- **Browsers**: Chrome, Firefox, Edge
- **Devices**: Desktop only (mobile screen reader testing is out of scope but recommended for future)
- **Focus Management**: Manual keyboard navigation testing through Tab/Shift+Tab
- **Form Testing**: Error announcement and validation testing

## Components Remediated

### 1. InvestorPortfolioTable Component
**File**: `frontend/components/InvestorPortfolioTable.tsx`

#### Violations Fixed
- **Missing Table Caption**: Added descriptive `<caption>` element
- **Missing Scope Attributes**: Added `scope="col"` to all header cells
- **Inaccessible Sort Controls**: 
  - Added `role="button"` to sortable headers
  - Added keyboard event handling (Enter/Space)
  - Added `aria-sort` attribute showing sort state ("ascending", "descending", "none")
  - Added visual indicator in `aria-hidden` span

#### Improvements Made
- Added proper filter group with `<fieldset>` and individual `<label>` elements
- Added `aria-label` to filter select elements
- Added unique IDs to all filter selects
- Added `aria-live="polite"` region for filter results summary
- Added keyboard navigation support for sort controls with `tabIndex={0}`
- Improved pagination controls with:
  - `role="navigation"` on pagination container
  - `aria-label` on navigation element
  - `aria-label` on individual buttons
  - `role="status" aria-live="polite"` for page number announcement

#### ARIA Attributes Added
```html
<table role="grid" aria-label="Investment portfolio">
  <caption class="sr-only">List of funded invoices with amounts, rates, and status</caption>
  <thead>
    <tr role="row">
      <th scope="col">Invoice ID</th>
      <th scope="col" role="button" tabIndex={0} aria-sort="ascending">
        Funded Amount
      </th>
      <!-- More sortable headers... -->
    </tr>
  </thead>
</table>
```

### 2. InvoiceWizard Component
**File**: `frontend/src/components/InvoiceWizard.tsx`

#### Violations Fixed
- **Form Error Announcements**: 
  - Added `aria-live="assertive"` region for validation error summary
  - Changed error spans to use `role="alert"` for immediate announcement
  - Added `aria-describedby` to inputs linking to error messages

- **Form Labels and IDs**:
  - Added unique `id` attributes to all form inputs
  - Updated label `htmlFor` attributes to match input IDs
  - Added `aria-invalid` attribute to inputs with errors

- **Focus Management**: 
  - Added `aria-current="step"` to current step indicator
  - Added progress bar with `role="progressbar"` and ARIA value attributes

#### Improvements Made
- Better fieldset/legend structure for each step
- Proper error message markup with `id` and `aria-describedby` connections
- Added `aria-atomic="true"` to error announcement region for complete message announcement
- Progress indicator with accessibility attributes
- Added buyer fields (buyerName, buyerEmail) with proper ARIA attributes

#### ARIA Attributes Added
```html
<form>
  <div role="status" aria-live="assertive" aria-atomic="true">
    {errorMessage}
  </div>
  
  <fieldset aria-labelledby="details-title">
    <legend id="details-title">Crop details</legend>
    
    <label htmlFor="cropName">
      Crop name
      <input
        id="cropName"
        aria-invalid={hasError}
        aria-describedby={hasError ? 'cropName-error' : undefined}
      />
      <span id="cropName-error" role="alert">
        Error message
      </span>
    </label>
  </fieldset>
  
  <div class="progress-bar" role="progressbar" aria-valuenow={50} aria-valuemin={0} aria-valuemax={100} />
</form>
```

## Accessibility Features Summary

### Table Features
- ✅ Proper table structure with caption, scope attributes
- ✅ Sortable columns with ARIA sort state
- ✅ Keyboard-accessible sort controls
- ✅ Accessible filtering with labeled select elements
- ✅ Pagination with proper navigation semantics
- ✅ Live region for result count updates
- ✅ Status pill styling with semantic HTML

### Form Features
- ✅ Multi-step form with progress indicator
- ✅ Error announcements via aria-live region
- ✅ Individual error messages with role="alert"
- ✅ Input validation with aria-invalid
- ✅ All inputs have associated labels with htmlFor
- ✅ Proper fieldset/legend structure per step
- ✅ Progress tracking with aria-valuenow
- ✅ Buyer information fields with full accessibility

## Testing Coverage

### Automated Tests
```bash
npm run test:a11y
```

Tests are located in `frontend/__tests__/a11y/` and cover:
- Table ARIA attributes
- Form error announcements
- Focus management
- Keyboard navigation
- Label associations

### Manual Testing Checklist
- [ ] Tab through entire invoice creation wizard
- [ ] Verify error messages announced by screen reader
- [ ] Test sort functionality with keyboard (Tab + Enter)
- [ ] Test filter changes with screen reader
- [ ] Navigate pagination with keyboard
- [ ] Verify focus management in form steps

## Browser and Screen Reader Support

### Tested Configurations
- Chrome + Chrome Vox
- Firefox + NVDA (with accessibility extensions)
- Edge + Narrator
- Keyboard-only navigation (Tab, Shift+Tab, Enter, Space)

## Out of Scope (Recommended for Future)
- Mobile screen reader testing (iOS VoiceOver, Android TalkBack)
- WCAG AAA (Level AAA) compliance
- Keyboard shortcut customization
- High contrast mode (supported by OS but not explicitly tested)

## Maintenance Going Forward

### Before Merging Any UI Changes
1. Run `npm run test:a11y` to check for new violations
2. Update axe-core rules if needed
3. Test with keyboard navigation
4. Verify error announcements with screen reader

### Adding New Components
1. Use semantic HTML first (button, label, fieldset, etc.)
2. Add ARIA attributes only when semantic HTML is insufficient
3. Test with axe-core before committing
4. Document any custom keyboard interactions

## CI/CD Integration

The CI workflow runs accessibility tests automatically:
```yaml
- name: Run accessibility tests
  run: npm run test:a11y
```

Failed accessibility tests block PR merges to enforce compliance.

## Resources
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [axe-core Documentation](https://github.com/dequelabs/axe-core/blob/develop/README.md)
- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [MDN ARIA Guide](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA)
