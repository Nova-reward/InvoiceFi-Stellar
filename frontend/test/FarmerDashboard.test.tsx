import { render, screen, act } from '@testing-library/react';
import FarmerDashboard from '../app/dashboard/farmer/page';
import * as useInvoiceNotificationsModule from '../hooks/useInvoiceNotifications';

// Mock the hook to manually trigger events
jest.mock('../hooks/useInvoiceNotifications');

describe('FarmerDashboard', () => {
  let mockHookReturnValue: any;

  beforeEach(() => {
    mockHookReturnValue = {
      events: [],
      connected: true,
    };

    jest.spyOn(useInvoiceNotificationsModule, 'useInvoiceNotifications')
      .mockImplementation(() => mockHookReturnValue);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('updates invoice status when a socket event is received without reloading', () => {
    const { rerender } = render(<FarmerDashboard />);

    // Verify initial state
    expect(screen.getByTestId('invoice-row-1')).toHaveTextContent('created');

    // Simulate receiving an event via the socket hook
    mockHookReturnValue.events = [{
      invoiceId: 1,
      event: 'funded',
      timestamp: new Date().toISOString()
    }];

    // Rerender component to reflect the hook's new return value
    act(() => {
      rerender(<FarmerDashboard />);
    });

    // Verify UI updated
    expect(screen.getByTestId('invoice-row-1')).toHaveTextContent('funded');
    // Ensure sibling row wasn't affected
    expect(screen.getByTestId('invoice-row-2')).toHaveTextContent('submitted');
  });

  it('shows the offline banner when socket is disconnected', () => {
    mockHookReturnValue.connected = false;
    render(<FarmerDashboard />);

    expect(screen.getByText(/Socket disconnected/i)).toBeInTheDocument();
  });
});