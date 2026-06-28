const dns = require("dns");

dns.setServers(["8.8.8.8", "8.8.4.4"]);

console.log("Servers:", dns.getServers());

dns.resolveSrv(
  "_mongodb._tcp.cluster0.bdddt4b.mongodb.net",
  (err, records) => {
    console.log("Error:", err);
    console.log("Records:", records);
  }
);