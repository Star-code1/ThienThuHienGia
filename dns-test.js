const dns = require("dns").promises;

(async () => {
  try {
    const result = await dns.resolveSrv(
      "_mongodb._tcp.cluster0.bdddt4b.mongodb.net"
    );
    console.log(result);
  } catch (e) {
    console.error(e);
  }
})();