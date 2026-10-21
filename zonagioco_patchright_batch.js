const { chromium } = require("patchright");
const { createHash } = require("node:crypto");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const USER_DATA_DIR = path.join(__dirname, "patchright_profile");

const DEFAULTS = Object.freeze({
  baseUrl: null,
  concurrency: 5,
  headless: false,
  jsonOutputPath: path.join(__dirname, "zonagioco_debug.json"),
  logSummary: true,
  logWarnings: true,
  maxRetries: 2,
  navigationTimeoutMs: 30_000,
  allowSafetyNavigation: true,
  retryBaseDelayMs: 500,
  saveJsonToFile: true,
  screenshotsBaseDirectory: path.join(__dirname, "zonagioco_screenshots"),
  screenshotsEnabledFailure: true,
  screenshotsEnabledSuccess: false,
  userDataDir: USER_DATA_DIR,
  extraHTTPHeaders: {},
});

class HttpStatusError extends Error {
  constructor(status) {
    super(`Navigation returned HTTP ${status}.`);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

class JsonParseError extends Error {
  constructor(status, cause) {
    super(`Response body is not valid JSON (HTTP ${status}).`, { cause });
    this.name = "JsonParseError";
    this.status = status;
  }
}

function requireNonNegativeInteger(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer.`);
  }
}

function requireBoolean(name, value) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean.`);
  }
}

function normalizeOptions(options) {
  const settings = { ...DEFAULTS, ...options };

  if (!Number.isInteger(settings.concurrency) || settings.concurrency <= 0) {
    throw new TypeError("concurrency must be a positive integer.");
  }

  if (
    !Number.isInteger(settings.navigationTimeoutMs) ||
    settings.navigationTimeoutMs <= 0
  ) {
    throw new TypeError("navigationTimeoutMs must be a positive integer.");
  }

  requireNonNegativeInteger("maxRetries", settings.maxRetries);
  requireNonNegativeInteger("retryBaseDelayMs", settings.retryBaseDelayMs);
  requireBoolean(
    "screenshotsEnabledFailure",
    settings.screenshotsEnabledFailure,
  );
  requireBoolean("saveJsonToFile", settings.saveJsonToFile);
  requireBoolean(
    "screenshotsEnabledSuccess",
    settings.screenshotsEnabledSuccess,
  );

  if (
    typeof settings.screenshotsBaseDirectory !== "string" ||
    !settings.screenshotsBaseDirectory
  ) {
    throw new TypeError("screenshotsBaseDirectory must be a non-empty string.");
  }

  if (
    settings.saveJsonToFile &&
    (typeof settings.jsonOutputPath !== "string" || !settings.jsonOutputPath)
  ) {
    throw new TypeError("jsonOutputPath must be a non-empty string.");
  }

  if (typeof settings.userDataDir !== "string" || !settings.userDataDir) {
    throw new TypeError("userDataDir must be a non-empty string.");
  }

  if (
    settings.extraHTTPHeaders && typeof settings.extraHTTPHeaders !== "object"
  ) {
    throw new TypeError("extraHTTPHeaders setting must be an object.");
  }

  if (settings.baseUrl !== null) {
    validateUrl(settings.baseUrl);
  }

  return settings;
}

function validateUrl(url) {
  if (typeof url !== "string" || !url.trim()) {
    throw new TypeError("URL must be a non-empty string.");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new TypeError(`URL is not a valid absolute URL: ${url}`, {
      cause: error,
    });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new TypeError(`Unsupported URL protocol: ${parsedUrl.protocol}`);
  }
}

function serializeError(error) {
  if (!(error instanceof Error)) {
    return {
      name: "Error",
      message: String(error),
      stack: null,
    };
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack ?? null,
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createRunDirectory(baseDirectory) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(baseDirectory, `${timestamp}-${process.pid}`);
}

function createScreenshotPath(runDirectory, index, url, urlCount) {
  const indexWidth = Math.max(4, String(Math.max(urlCount - 1, 0)).length);
  const paddedIndex = String(index).padStart(indexWidth, "0");
  const urlHash = createHash("sha256").update(url).digest("hex").slice(0, 8);

  return path.join(runDirectory, `${paddedIndex}-${urlHash}.png`);
}

async function captureScreenshot(page, screenshotPath, logWarnings) {
  try {
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });
    return screenshotPath;
  } catch (error) {
    if (logWarnings) {
      console.warn(
        `Could not capture screenshot ${screenshotPath}:`,
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  }
}

async function navigateToJson(page, url, navigationTimeoutMs, extraHTTPHeaders) {
  page.setDefaultNavigationTimeout(navigationTimeoutMs);
  page.setDefaultTimeout(navigationTimeoutMs);

  // Header aggiuntivi eventualmente necessari per ottenere la risposta.
  // Valgono solo per questa navigazione e poi si tolgono, così non finiscono
  // sulle richieste della navigazione "safety" verso le pagine HTML.
  await page.setExtraHTTPHeaders(extraHTTPHeaders);

  let response;
  try {
    response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs,
    });
  } finally {
    await page.setExtraHTTPHeaders({});
  }

  if (!response) {
    throw new Error("Navigation completed without a main resource response.");
  }

  const status = response.status();
  const responseText = await response.text();

  if (!response.ok()) {
    throw new HttpStatusError(status);
  }

  try {
    return {
      data: JSON.parse(responseText),
      status,
    };
  } catch (error) {
    throw new JsonParseError(status, error);
  }
}

function warnAboutSafetyNavigation(settings, index, safetyUrl, error) {
  if (!settings.logWarnings) {
    return;
  }

  const reason = error instanceof Error ? error.message : String(error);
  console.warn(
    `Skipping safety URL for target ${index} (${String(safetyUrl)}): ${reason}`,
  );
}

async function visitSafetyUrlBeforeFinalRetry({
  context,
  index,
  initialPage,
  url,
  safetyUrl,
  settings,
}) {
  let page = initialPage;

  try {
    validateUrl(safetyUrl);
  } catch (error) {
    warnAboutSafetyNavigation(settings, index, safetyUrl, error);
    return page;
  }

  try {
    if (page.isClosed()) {
      page = await context.newPage();
    }

    page.setDefaultNavigationTimeout(settings.navigationTimeoutMs);
    page.setDefaultTimeout(settings.navigationTimeoutMs);

    let response;

    try {
      const requestRegex = /.*detail-service\/sport-schedule\/services\/meeting.*/;

      const dataRequestPromise = page.waitForRequest(requestRegex, {
        timeout: 5_000
      });

      response = await page.goto(safetyUrl, {
        waitUntil: "commit",
        timeout: settings.navigationTimeoutMs,
      });
      await dataRequestPromise;
      await wait(1_000);
    } catch (error) {
      await captureScreenshot(page, './safety_screenshot/safety.png', true);
      warnAboutSafetyNavigation(settings, index, safetyUrl, error);

      let replacementPage;

      try {
        replacementPage = await context.newPage();
      } catch (replacementError) {
        warnAboutSafetyNavigation(
          settings,
          index,
          safetyUrl,
          replacementError,
        );
        return page;
      }

      if (!page.isClosed()) {
        await page.close().catch(() => { });
      }

      return replacementPage;
    }

    if (!response) {
      warnAboutSafetyNavigation(
        settings,
        index,
        safetyUrl,
        new Error(
          "Safety navigation completed without a main resource response.",
        ),
      );
      return page;
    }

    if (!response.ok()) {
      warnAboutSafetyNavigation(
        settings,
        index,
        safetyUrl,
        new HttpStatusError(response.status()),
      );
    }
  } catch (error) {
    warnAboutSafetyNavigation(settings, index, safetyUrl, error);
  }

  return page;
}

async function scrapeUrlWithRetries({
  context,
  index,
  initialPage,
  runDirectory,
  settings,
  url,
  safetyUrl,
  sport,
  campionato,
  nazione,
  descrizione,
  mercato,
  urlCount,
}) {
  const maximumAttempts = settings.maxRetries + 1;
  const screenshotsEnabled =
    settings.screenshotsEnabledSuccess || settings.screenshotsEnabledFailure;
  const screenshotPath = screenshotsEnabled
    ? createScreenshotPath(runDirectory, index, url, urlCount)
    : null;
  let attempts = 0;
  let lastError;
  let lastStatus = null;
  let page = initialPage;

  while (attempts < maximumAttempts) {
    attempts += 1;

    try {
      if (page.isClosed()) {
        page = await context.newPage();
      }

      const result = await navigateToJson(
        page,
        url,
        settings.navigationTimeoutMs,
        settings.extraHTTPHeaders,
      );

      if (screenshotPath && settings.screenshotsEnabledSuccess) {
        await captureScreenshot(page, screenshotPath, settings.logWarnings);
      }

      return {
        attempts,
        data: { data: result.data, sport, campionato, nazione, descrizione, mercato },
        page,
        success: true,
      };
    } catch (error) {
      lastError = error;
      lastStatus = Number.isInteger(error?.status) ? error.status : lastStatus;

      if (attempts < maximumAttempts) {
        const backoffMs =
          settings.retryBaseDelayMs * 2 ** Math.max(attempts - 1, 0);
        await wait(backoffMs);

        if (attempts === maximumAttempts - 1 && settings.allowSafetyNavigation) {
          console.log('Attempting to visit safety URL before final retry for target', index, '(', url, ')');
          page = await visitSafetyUrlBeforeFinalRetry({
            context,
            index,
            initialPage: page,
            url,
            safetyUrl,
            settings,
          });
        }
      }
    }
  }

  const capturedFailurePath =
    screenshotPath && settings.screenshotsEnabledFailure
      ? await captureScreenshot(page, screenshotPath, settings.logWarnings)
      : null;
  const failure = {
    index,
    url,
    safetyUrl,
    campionato,
    nazione,
    descrizione,
    mercato,
    attempts,
    status: lastStatus,
    error: serializeError(lastError),
  };

  if (settings.screenshotsEnabledFailure) {
    failure.screenshotPath = capturedFailurePath;
  }

  return {
    attempts,
    failure,
    page,
    success: false,
  };
}

function createSummary({
  concurrency,
  durationMs,
  failed,
  succeeded,
  total,
  totalAttempts,
}) {
  const durationSeconds = durationMs / 1_000;

  return {
    concurrency,
    total,
    succeeded,
    failed,
    totalAttempts,
    durationMs: Math.round(durationMs),
    urlsPerSecond:
      durationSeconds > 0 ? Number((total / durationSeconds).toFixed(2)) : 0,
  };
}

async function scrapeUrls(targets, options = {}) {
  if (!Array.isArray(targets)) {
    throw new TypeError("scrapeUrls(targets) expects an array.");
  }

  const settings = normalizeOptions(options);
  const startedAt = performance.now();
  const successByIndex = new Array(targets.length);
  const errorsByIndex = new Array(targets.length);
  const jobs = [];
  let totalAttempts = 0;

  if (settings.saveJsonToFile) {
    await mkdir(path.dirname(settings.jsonOutputPath), { recursive: true });
    await writeFile(settings.jsonOutputPath, "[]\n", "utf8");
  }

  for (let index = 0; index < targets.length; index += 1) {
    const url = targets[index].url;
    const safetyUrl = targets[index].safetyUrl;
    const sport = targets[index].sport;
    const campionato = targets[index].campionato;
    const nazione = targets[index].nazione;
    const descrizione = targets[index].descrizione;
    const mercato = targets[index].mercato;

    try {
      validateUrl(url);
      jobs.push({
        index,
        url,
        safetyUrl,
        sport,
        campionato,
        nazione,
        descrizione,
        mercato,
      });
    } catch (error) {
      const failure = {
        index,
        url,
        safetyUrl,
        sport,
        campionato,
        nazione,
        descrizione,
        mercato,
        attempts: 0,
        status: null,
        error: serializeError(error),
      };

      if (settings.screenshotsEnabledFailure) {
        failure.screenshotPath = null;
      }

      errorsByIndex[index] = failure;
    }
  }

  if (jobs.length === 0) {
    const errors = errorsByIndex.filter((error) => error !== undefined);
    const summary = createSummary({
      concurrency: 0,
      durationMs: performance.now() - startedAt,
      failed: errors.length,
      succeeded: 0,
      total: targets.length,
      totalAttempts,
    });

    if (settings.logSummary) {
      console.log("Zonagioco batch summary:", summary);
    }

    return { data: [], errors };
  }

  const workerCount = Math.min(settings.concurrency, jobs.length);
  const runDirectory =
    settings.screenshotsEnabledSuccess || settings.screenshotsEnabledFailure
      ? createRunDirectory(settings.screenshotsBaseDirectory)
      : null;
  let context;
  let jobCursor = 0;

  if (runDirectory) {
    await mkdir(runDirectory, { recursive: true });
  }

  try {
    context = await chromium.launchPersistentContext(settings.userDataDir, {
      channel: "chrome",
      headless: settings.headless,
      viewport: null,
    });

    const availablePages = context.pages();

    if (settings.baseUrl) {
      const basePage = availablePages.shift() ?? (await context.newPage());
      basePage.setDefaultNavigationTimeout(settings.navigationTimeoutMs);
      basePage.setDefaultTimeout(settings.navigationTimeoutMs);
      await basePage.goto(settings.baseUrl, {
        waitUntil: "load",
        timeout: settings.navigationTimeoutMs,
      });
    }

    const workers = Array.from(
      { length: workerCount },
      async (_, workerIndex) => {
        let page;

        try {
          page = availablePages[workerIndex] ?? (await context.newPage());

          while (jobCursor < jobs.length) {
            const job = jobs[jobCursor];
            jobCursor += 1;

            const outcome = await scrapeUrlWithRetries({
              context,
              index: job.index,
              initialPage: page,
              runDirectory,
              settings,
              url: job.url,
              safetyUrl: job.safetyUrl,
              sport: job.sport,
              campionato: job.campionato,
              nazione: job.nazione,
              descrizione: job.descrizione,
              mercato: job.mercato,
              urlCount: targets.length,
            });

            page = outcome.page;
            totalAttempts += outcome.attempts;

            if (outcome.success) {
              successByIndex[job.index] = { data: outcome.data };
            } else {
              errorsByIndex[job.index] = outcome.failure;
            }
          }
        } finally {
          if (page && !page.isClosed()) {
            await page.close().catch(() => { });
          }
        }
      },
    );

    await Promise.all(workers);
  } finally {
    await context?.close();
  }

  const data = successByIndex
    .filter((result) => result !== undefined)
    .map((result) => result.data);
  const errors = errorsByIndex.filter((error) => error !== undefined);
  const summary = createSummary({
    concurrency: workerCount,
    durationMs: performance.now() - startedAt,
    failed: errors.length,
    succeeded: data.length,
    total: targets.length,
    totalAttempts,
  });

  if (settings.saveJsonToFile) {
    await writeFile(
      settings.jsonOutputPath,
      `${JSON.stringify(data, null, 2)}\n`,
      "utf8",
    );
  }

  if (settings.logSummary) {
    console.log("Zonagioco batch summary:", summary);
  }

  return { data, errors };
}

module.exports = {
  scrapeUrls,
};
