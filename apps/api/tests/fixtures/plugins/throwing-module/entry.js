// Throws during module evaluation. The loader must catch the failed dynamic
// import and quarantine the directory rather than let this propagate.
throw new Error('boom: this module always throws at import time');
