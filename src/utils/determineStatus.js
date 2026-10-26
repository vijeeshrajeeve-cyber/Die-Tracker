import { isTooling } from './oracleEntry.js';

export const hasDieReceivedDate = (order) => {
  const d = order?.['Die Received Date'];
  return d != null && String(d).trim() !== '';
};

// Auto-determine an order's status from its filled dates, for drawer edits.
// Dates are checked in reverse order of progress to find the current stage.
export const determineStatus = (orderData) => {
  if (orderData.STATUS === 'CANCELLED' || orderData.STATUS === 'HOLD') return orderData.STATUS;

  // A tooling skips Oracle Entry: PR entry takes it on as an Oracle entry would.
  if ((orderData['Oracle Entry'] || isTooling(orderData)) && orderData['PR Entry'] && orderData['Design Approved Date'] && orderData['Design Received Date'] && orderData['Ordered date']) {
    if (hasDieReceivedDate(orderData)) return 'DIE RECEIVED';
    return 'DONE';
  }
  if (orderData['PR Entry'] && orderData['Design Approved Date'] && orderData['Design Received Date'] && orderData['Ordered date']) {
    return 'PENDING FOR ORACLE ENTRY';
  }
  if (orderData['Design Approved Date'] && orderData['Design Received Date'] && orderData['Ordered date']) {
    return 'PENDING FOR PR';
  }
  // Simulation is passed only by an OK result, which records the Simulation
  // Completed Date. A die already in Simulation stays there even before its 3D
  // model arrives; a model date typed in for a simulation order puts it there.
  if (orderData.simulationEnabled && orderData['Design Received Date'] && orderData['Ordered date']
    && !orderData['Simulation Completed Date']
    && (orderData.STATUS === 'UNDER SIMULATION' || orderData['3D Model Received Date'])) {
    return 'UNDER SIMULATION';
  }
  if (orderData['Design Received Date'] && orderData['Ordered date']) {
    return 'PENDING FOR DESIGN APPROVAL';
  }
  if (orderData['Ordered date']) {
    return 'AWAITING FOR DESIGN';
  }
  return 'PENDING FOR ORDERING';
};
