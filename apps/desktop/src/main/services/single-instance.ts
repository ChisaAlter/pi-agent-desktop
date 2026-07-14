interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  on(event: "second-instance", listener: () => void): unknown;
  quit(): void;
}

export function registerSingleInstance(
  app: SingleInstanceApp,
  restoreExistingWindow: () => void,
): boolean {
  const isPrimaryInstance = app.requestSingleInstanceLock();
  if (!isPrimaryInstance) {
    app.quit();
    return false;
  }

  app.on("second-instance", restoreExistingWindow);
  return true;
}
