const { spawn } = require("node:child_process");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const XVFB_RUN = "xvfb-run";
const SCRAPER_SCRIPT = path.join(__dirname, "zonagioco_patchright.js");

function runScraper() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      XVFB_RUN,
      ["-a", process.execPath, SCRAPER_SCRIPT],
      {
        cwd: __dirname,
        stdio: "inherit",
      },
    );
    const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
    const signalHandlers = new Map(
      forwardedSignals.map((signal) => [
        signal,
        () => forwardSignal(signal),
      ]),
    );

    const forwardSignal = (signal) => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    };

    const removeSignalHandlers = () => {
      for (const signal of forwardedSignals) {
        process.off(signal, signalHandlers.get(signal));
      }
    };

    for (const signal of forwardedSignals) {
      process.on(signal, signalHandlers.get(signal));
    }

    child.once("error", (error) => {
      removeSignalHandlers();
      reject(
        new Error(
          `Could not start ${XVFB_RUN}. Verify that Xvfb is installed and xvfb-run is available in PATH.`,
          { cause: error },
        ),
      );
    });

    child.once("exit", (code, signal) => {
      removeSignalHandlers();

      if (signal) {
        const signalNumber = os.constants.signals[signal];
        resolve(Number.isInteger(signalNumber) ? 128 + signalNumber : 1);
        return;
      }

      resolve(code ?? 1);
    });
  });
}

if (require.main === module) {
  runScraper()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      fs.writeFileSync(
        path.join(__dirname, "zonagioco_patchright.error.log"),
        error instanceof Error ? error.stack : String(error),
        { flag: "a" },
      );
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}

module.exports = {
  runScraper,
};
