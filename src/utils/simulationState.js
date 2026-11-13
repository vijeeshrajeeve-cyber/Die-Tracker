// What became of an order's simulation requirement. "Simulation required" is
// only the request: the order then either passes (Simulation Completed Date)
// or is skipped with a reason (Simulation Skipped Date). A skip lets the order
// move on like a pass, but the order was never simulated.

const filled = (value) => value !== null && value !== undefined && String(value).trim() !== '';

export const isSimulationEnabled = (value) => {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return /^(true|1|yes|ok|required)$/i.test(value.trim());
  return false;
};

// A real pass outranks a skip: a die skipped once and simulated later was simulated.
export const simulationSkipped = (order) => filled(order?.['Simulation Skipped Date'])
  && !filled(order?.['Simulation Completed Date']);

// The date the order got past Simulation, by a pass or by a skip.
export const simulationPassDate = (order) => {
  if (filled(order?.['Simulation Completed Date'])) return order['Simulation Completed Date'];
  return simulationSkipped(order) ? order['Simulation Skipped Date'] : null;
};

// For lead times: a skipped order belongs with the orders that had no simulation.
export const wasSimulated = (order) => isSimulationEnabled(order?.simulationEnabled) && !simulationSkipped(order);
