console.log("PAYFI FAUCET STARTING...");

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const axios = require("axios");
const { execSync } = require("child_process");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================================
   CONFIG
========================================= */

const CHAIN_ID =
"payfiblockchain";

const REST_API =
"https://payfiblockchain.onrender.com";

const SENDER =
"alice";

const SENDER_ADDRESS =
"payfi1uqseua5zpfgtffdp5mattcegxha3ee68gf4fwt";

const AMOUNT =
"5payfi";

const FEES =
"0.1payfi";

const GAS =
"200000";

/* =========================================
   WINDOWS / RENDER
========================================= */

let BINARY;
let HOME;
let SHELL;

if (process.platform === "win32") {

  console.log("WINDOWS MODE");

  BINARY =
  ".\\payfiblockchaind.exe";

  HOME =
  "C:\\Users\\Abhay\\.payfiblockchain";

  SHELL =
  "cmd.exe";

} else {

  console.log("LINUX / RENDER MODE");

  BINARY =
  "./payfiblockchaind";

  HOME =
  "/opt/render/.payfiblockchain";

  SHELL =
  "/bin/bash";

}

/* =========================================
   IMPORT ALICE KEY (RENDER)
========================================= */

if (process.platform !== "win32") {

  try {

    console.log("Importing alice key...");

    execSync(
      `echo "horn crater disagree stairs rare shop shed visa guilt clown push police junk claw list worry breeze liar seminar health replace city copy license" | ./payfiblockchaind keys add alice --recover --keyring-backend test --home "/opt/render/.payfiblockchain"`,
      {
        shell: "/bin/bash"
      }
    );

    console.log("Alice key imported");

  } catch (err) {

    console.log(
      "Alice key may already exist"
    );

  }

}

/* =========================================
   CLAIM DATABASE
========================================= */

const CLAIMS_FILE =
"./claims.json";

if (!fs.existsSync(CLAIMS_FILE)) {

  fs.writeFileSync(
    CLAIMS_FILE,
    "{}"
  );

}

function loadClaims() {

  return JSON.parse(
    fs.readFileSync(CLAIMS_FILE)
  );

}

function saveClaims(claims) {

  fs.writeFileSync(
    CLAIMS_FILE,
    JSON.stringify(claims, null, 2)
  );

}

/* =========================================
   HOME
========================================= */

app.get("/", (req, res) => {

  res.send("PayFi Faucet Running");

});

app.get("/health", (req, res) => {

  res.json({
    success: true
  });

});

/* =========================================
   FAUCET
========================================= */

app.post("/faucet", async (req, res) => {

  try {

    const { address } = req.body;

    console.log("================================");
    console.log("NEW REQUEST");
    console.log("================================");

    console.log("ADDRESS:", address);

    /* =====================================
       VALIDATION
    ===================================== */

    if (!address) {

      return res.status(400).json({
        error:
        "Wallet address required"
      });

    }

    if (!address.startsWith("payfi1")) {

      return res.status(400).json({
        error:
        "Invalid PayFi wallet"
      });

    }

    /* =====================================
       CLAIM LIMIT
    ===================================== */

    const claims =
    loadClaims();

    const now =
    Date.now();

    const DAY =
    24 * 60 * 60 * 1000;

    if (
      claims[address] &&
      now - claims[address] < DAY
    ) {

      return res.status(429).json({
        error:
        "Already claimed in last 24h"
      });

    }

    /* =====================================
       CLEAN FILES
    ===================================== */

    try {
      fs.unlinkSync(
        "unsigned.json"
      );
    } catch {}

    try {
      fs.unlinkSync(
        "signed.json"
      );
    } catch {}

    /* =====================================
       FETCH ACCOUNT
    ===================================== */

    console.log("Fetching account...");

    const accountRes =
    await axios.get(
      `${REST_API}/cosmos/auth/v1beta1/accounts/${SENDER_ADDRESS}`
    );

    const ACCOUNT_NUMBER =
    parseInt(
      accountRes.data.account.account_number
    );

    const SEQUENCE =
    parseInt(
      accountRes.data.account.sequence
    );

    console.log(
      "ACCOUNT:",
      ACCOUNT_NUMBER
    );

    console.log(
      "SEQUENCE:",
      SEQUENCE
    );

    /* =====================================
       GENERATE TX
    ===================================== */

    console.log("Generating tx...");

    const unsignedTx =
    execSync(
      `${BINARY} tx bank send ${SENDER} ${address} ${AMOUNT} --chain-id ${CHAIN_ID} --fees ${FEES} --gas ${GAS} --keyring-backend test --home "${HOME}" --generate-only --output json`,
      {
        shell: SHELL,
        stdio: "pipe"
      }
    ).toString();

    fs.writeFileSync(
      "unsigned.json",
      unsignedTx
    );

    console.log("unsigned.json created");

    /* =====================================
       SIGN TX
    ===================================== */

    console.log("Signing tx...");

    const signedTx =
    execSync(
      `${BINARY} tx sign unsigned.json --from ${SENDER} --chain-id ${CHAIN_ID} --account-number ${ACCOUNT_NUMBER} --sequence ${SEQUENCE} --keyring-backend test --home "${HOME}" --offline --output json`,
      {
        shell: SHELL,
        stdio: "pipe"
      }
    ).toString();

    fs.writeFileSync(
      "signed.json",
      signedTx
    );

    console.log("signed.json created");

    /* =====================================
       ENCODE TX
    ===================================== */

    console.log("Encoding tx...");

    const txBytes =
    execSync(
      `${BINARY} tx encode signed.json`,
      {
        shell: SHELL,
        stdio: "pipe"
      }
    )
    .toString()
    .trim();

    console.log("TX BYTES GENERATED");

    /* =====================================
       BROADCAST
    ===================================== */

    console.log("Broadcasting tx...");

    const broadcast =
    await axios.post(
      `${REST_API}/cosmos/tx/v1beta1/txs`,
      {
        tx_bytes: txBytes,
        mode:
        "BROADCAST_MODE_SYNC"
      }
    );

    console.log("BROADCAST RESPONSE:");
    console.log(broadcast.data);

    const tx =
    broadcast.data.tx_response;

    if (
      tx.code &&
      tx.code !== 0
    ) {

      return res.status(500).json({
        error:
        tx.raw_log || `TX FAILED CODE ${tx.code}`
      });

    }

    /* =====================================
       SAVE CLAIM
    ===================================== */

    claims[address] = now;

    saveClaims(claims);

    /* =====================================
       SUCCESS
    ===================================== */

    res.json({
      success: true,
      amount: AMOUNT,
      txhash:
      tx.txhash
    });

  } catch (err) {

    console.log("================================");
    console.log("FULL ERROR");
    console.log("================================");

    console.log(err);

    console.log("================================");
    console.log("MESSAGE");
    console.log("================================");

    console.log(err.message);

    console.log("================================");
    console.log("STDERR");
    console.log("================================");

    console.log(
      err.stderr?.toString()
    );

    console.log("================================");
    console.log("STDOUT");
    console.log("================================");

    console.log(
      err.stdout?.toString()
    );

    res.status(500).json({
      error:
        err.stderr?.toString() ||
        err.stdout?.toString() ||
        err.message ||
        "Unknown error"
    });

  }

});

/* =========================================
   START SERVER
========================================= */

const PORT =
process.env.PORT || 3001;

app.listen(PORT, () => {

  console.log(`
==================================
       PAYFI FAUCET
==================================
RUNNING ON PORT ${PORT}
==================================
`);

});