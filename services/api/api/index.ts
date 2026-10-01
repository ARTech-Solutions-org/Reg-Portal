let appHandler;
try {
  const mod = await import("../src/app.js");
  appHandler = mod.default;
} catch (error) {
  appHandler = (req, res) => {
    res.status(500).json({ error: "Boot error", details: error.message, stack: error.stack });
  };
}

export default appHandler;
