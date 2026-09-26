// Runs before the page is drawn, so a theme picked on the dashboard (light or
// dark) never flashes the other one first. With no choice saved, the page
// follows the device's setting through CSS alone.
(function () {
  try {
    var theme = window.localStorage.getItem("strata.theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch (error) {
    // Storage is blocked (private window, strict settings): follow the device.
  }
})();
