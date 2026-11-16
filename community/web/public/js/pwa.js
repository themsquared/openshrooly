/** Register the site service worker so phones can install Shroom Labs. */
if ("serviceWorker" in navigator) {
  // When a new worker takes over an already controlled page, reload once so the installed app runs the new code.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener("load", () => {
    const registering = navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    registering
      .then((reg) => {
        // An installed app can stay open for days. Look for a new worker whenever it comes back to the front.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
}
