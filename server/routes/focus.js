const express = require("express");
const {
  completeSession,
  breakSession,
  initializeFocusState,
  getStats,
} = require("../utils/focusManager");

function defaultResolveUserId(req) {
  return (
    req.header("x-focus-user") ||
    req.query.userId ||
    req.body?.userId ||
    req.ip ||
    req.socket?.remoteAddress ||
    ""
  );
}

function createFocusRouter({ resolveUserId = defaultResolveUserId } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    const userId = String(resolveUserId(req) || "").trim();
    if (!userId) {
      res.status(400).json({ error: "Missing focus user id" });
      return;
    }

    req.focusUserId = userId;
    next();
  });

  router.post("/init", (req, res) => {
    try {
      const state = initializeFocusState(req.focusUserId);
      res.json(state);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/state", (req, res) => {
    try {
      const state = initializeFocusState(req.focusUserId);
      res.json(state);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/complete", (req, res) => {
    try {
      const { duration } = req.body || {};
      const payload = completeSession(req.focusUserId, duration);
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/break", (req, res) => {
    try {
      const { progressSec } = req.body || {};
      const payload = breakSession(req.focusUserId, progressSec);
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/stats", (req, res) => {
    try {
      const stats = getStats(req.focusUserId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = { createFocusRouter, defaultResolveUserId };
