import { CommissioningServer } from "@matter/main";

/**
 * matter.js logs the passcode, discriminator and QR on first start. Those stay
 * on the hub Smart Home page only.
 */
export class QuietCommissioningServer extends CommissioningServer {
  initiateCommissioning() {
    // Intentionally empty: do not write pairing secrets to stdout.
  }
}
