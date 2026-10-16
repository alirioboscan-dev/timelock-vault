import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Despliega TimelockVault. No tiene parámetros: no hay administrador ni configuración.
export default buildModule("TimelockVaultModule", (m) => {
  const timelockVault = m.contract("TimelockVault");
  return { timelockVault };
});
