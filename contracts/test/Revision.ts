// Tests de la revisión de seguridad de TimelockVault.
// R-xx: hallazgos. Los corregidos (R-01, R-02, R-05) son tests de regresión: comprueban que el
// ataque ya no funciona. R-03 se cubre en TimelockVault.ts ("la fecha compartida queda fija…").
// R-04 y R-06 quedan documentados como comportamiento aceptado.
// D-xx: hallazgos descartados (tests que muestran que el problema no existe).
import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { time, loadFixture } = networkHelpers;

const DIA = 24 * 60 * 60;
const MAX_UINT64 = 2n ** 64n - 1n;

async function desplegar() {
  const [alicia, bruno, carla] = await ethers.getSigners();
  const vault = await ethers.deployContract("TimelockVault");
  const desbloqueo = BigInt((await time.latest()) + 30 * DIA);
  return { vault, alicia, bruno, carla, desbloqueo };
}

async function conBovedaCompartida() {
  const base = await desplegar();
  const { vault, alicia, bruno, desbloqueo } = base;
  await vault.connect(alicia).createSharedVault("Casa", bruno.address, desbloqueo);
  await vault.connect(bruno).acceptSharedVault(1n);
  await vault.connect(alicia).depositShared(1n, { value: ethers.parseEther("0.3") });
  await vault.connect(bruno).depositShared(1n, { value: ethers.parseEther("0.7") });
  return { ...base, id: 1n };
}

type Vault = Awaited<ReturnType<typeof desplegar>>["vault"];

/** Suma de todos los saldos individuales y aportes compartidos registrados. */
async function sumaRegistrada(vault: Vault): Promise<bigint> {
  let suma = 0n;
  for (let i = 1n; i <= (await vault.vaultCount()); i++) suma += (await vault.getVaultDetails(i)).balance;
  for (let i = 1n; i <= (await vault.sharedVaultCount()); i++) {
    const s = await vault.getSharedVaultDetails(i);
    suma += s.contributions[0] + s.contributions[1];
  }
  return suma;
}

async function balanceDe(vault: Vault): Promise<bigint> {
  return ethers.provider.getBalance(await vault.getAddress());
}

// ===========================================================================
// Hallazgos corregidos (regresión)
// ===========================================================================

describe("R-01 (regresión) nombre inválido inyectado en la lista de otro", function () {
  it("R-01: una compartida con nombre UTF-8 inválido no entra en la lista del invitado", async function () {
    const { vault, alicia, carla, desbloqueo } = await loadFixture(desplegar);

    // `string` y `bytes` se codifican igual en ABI: se arma el calldata a mano con bytes no UTF-8.
    const selector = vault.interface.getFunction("createSharedVault").selector;
    const args = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes", "address", "uint64"],
      [new Uint8Array([0xff, 0xfe, 0x41]), alicia.address, desbloqueo],
    );
    await carla.sendTransaction({ to: await vault.getAddress(), data: selector + args.slice(2) });

    // La invitación existe, pero la lista de Alicia sigue vacía mientras ella no la acepte.
    expect(await vault.sharedVaultCount()).to.equal(1n);
    expect(await vault.getSharedVaultsOf(alicia.address)).to.deep.equal([]);
    expect(await vault.getSharedVaultsOf(carla.address)).to.deep.equal([1n]);
  });

  it("R-01: lo mismo con un nombre engañoso (U+202E)", async function () {
    const { vault, alicia, carla, desbloqueo } = await loadFixture(desplegar);
    await vault.connect(carla).createSharedVault("Ahorro ‮adac al arap‬", alicia.address, desbloqueo);
    expect(await vault.getSharedVaultsOf(alicia.address)).to.deep.equal([]);
  });
});

describe("R-02 (regresión) spam en la lista de bóvedas compartidas", function () {
  it("R-02: crear muchas invitaciones no agranda la lista de la víctima ni encarece su lectura", async function () {
    const { vault, alicia, carla, desbloqueo } = await loadFixture(desplegar);
    const datosLista = vault.interface.encodeFunctionData("getSharedVaultsOf", [alicia.address]);
    const destino = await vault.getAddress();
    const gasLista = () => ethers.provider.estimateGas({ to: destino, data: datosLista });

    const gasVacia = await gasLista();
    const N = 200;
    for (let i = 0; i < N; i++) {
      await vault.connect(carla).createSharedVault("Reclama tu premio en estafa.example", alicia.address, desbloqueo);
    }

    expect(await vault.getSharedVaultsOf(alicia.address)).to.deep.equal([]);
    expect(await gasLista()).to.equal(gasVacia);
    // La misma consulta con un presupuesto acotado, que antes fallaba, ahora responde.
    expect(await vault.getSharedVaultsOf.staticCall(alicia.address, { gasLimit: 200_000n })).to.deep.equal([]);
    // El spam solo crece la lista del propio atacante.
    expect((await vault.getSharedVaultsOf(carla.address)).length).to.equal(N);
  });
});

describe("R-05 (regresión) partner que nunca va a poder aprobar", function () {
  it("R-05: se rechaza el propio contrato como partner", async function () {
    const { vault, alicia, desbloqueo } = await loadFixture(desplegar);
    const contrato = await vault.getAddress();
    await expect(vault.connect(alicia).createSharedVault("x", contrato, desbloqueo))
      .to.be.revertedWithCustomError(vault, "InvalidPartner")
      .withArgs(contrato);
  });

  it("R-05: con cualquier otro partner que nunca acepta, no se puede aportar y no hay fondos en riesgo", async function () {
    const { vault, alicia, desbloqueo } = await loadFixture(desplegar);
    const inexistente = ethers.Wallet.createRandom().address;
    await vault.connect(alicia).createSharedVault("x", inexistente, desbloqueo);
    await expect(vault.connect(alicia).depositShared(1n, { value: 1n })).to.be.revertedWithCustomError(
      vault,
      "NotAccepted",
    );
    expect(await balanceDe(vault)).to.equal(0n);
  });
});

// ===========================================================================
// Hallazgos documentados (comportamiento aceptado)
// ===========================================================================

describe("R-04 ETH forzado queda atrapado para siempre", function () {
  it("R-04: el envío directo revierte, pero un selfdestruct deposita ETH que nadie puede retirar", async function () {
    const { vault, alicia, desbloqueo } = await loadFixture(desplegar);
    const destino = await vault.getAddress();
    await vault.connect(alicia).createVault("x", desbloqueo, { value: ethers.parseEther("1") });

    // Sin receive/fallback: una transferencia normal se rechaza.
    await expect(alicia.sendTransaction({ to: destino, value: 1n })).to.revert(ethers);

    // Código de creación PUSH20 <vault> SELFDESTRUCT: envía su valor al vault al desplegarse.
    const forzado = ethers.parseEther("0.5");
    await alicia.sendTransaction({ data: "0x73" + destino.slice(2) + "ff", value: forzado });

    expect(await balanceDe(vault)).to.equal((await sumaRegistrada(vault)) + forzado);
    await time.increaseTo(desbloqueo);
    await vault.connect(alicia).withdraw(1n);
    // Tras retirar todo lo registrado, el excedente sigue en el contrato y no hay función para recuperarlo.
    expect(await balanceDe(vault)).to.equal(forzado);
    expect(await sumaRegistrada(vault)).to.equal(0n);
  });
});

describe("R-06 el límite del nombre se mide en bytes, no en caracteres", function () {
  it("R-06: 32 'ó' (64 bytes) pasan, 33 'ó' (33 caracteres, 66 bytes) no; 17 emojis tampoco", async function () {
    const { vault, alicia, desbloqueo } = await loadFixture(desplegar);
    await vault.connect(alicia).createVault("ó".repeat(32), desbloqueo, { value: 1n });
    await expect(
      vault.connect(alicia).createVault("ó".repeat(33), desbloqueo, { value: 1n }),
    ).to.be.revertedWithCustomError(vault, "InvalidName");
    await expect(
      vault.connect(alicia).createVault("🏠".repeat(17), desbloqueo, { value: 1n }),
    ).to.be.revertedWithCustomError(vault, "InvalidName");
  });
});

// ===========================================================================
// Hallazgos descartados (tests que muestran que el problema no existe)
// ===========================================================================

describe("D-01 reentrancia cruzada entre funciones y entre bóvedas", function () {
  it("D-01: reentrar de withdraw a withdrawShared solo cobra lo propio y la contabilidad cierra", async function () {
    const { vault, bruno, carla, desbloqueo } = await loadFixture(desplegar);
    const atacante = await ethers.deployContract("ReentrancyAttacker", [await vault.getAddress()]);
    const individual = ethers.parseEther("1");
    const aporte = ethers.parseEther("2");
    await atacante.createVault(desbloqueo, { value: individual });
    await atacante.createSharedVault(bruno.address, desbloqueo);
    await vault.connect(bruno).acceptSharedVault(1n);
    await atacante.depositShared({ value: aporte });
    await vault.connect(bruno).depositShared(1n, { value: ethers.parseEther("3") });
    await vault.connect(carla).createVault("botín", desbloqueo, { value: ethers.parseEther("5") });
    await atacante.approveShared();
    await vault.connect(bruno).approveWithdrawal(1n);
    await time.increaseTo(desbloqueo);

    // attack() llama withdraw; en receive() el atacante reentra en withdrawShared.
    await expect(atacante.attack()).to.changeEtherBalances(
      ethers,
      [atacante, vault],
      [individual + aporte, -(individual + aporte)],
    );
    expect(await atacante.reentrySucceeded()).to.equal(true); // la reentrada es legítima: es su propio aporte
    expect((await vault.getSharedVaultDetails(1n)).contributions[1]).to.equal(ethers.parseEther("3"));
    expect((await vault.getVaultDetails(2n)).balance).to.equal(ethers.parseEther("5"));
    expect(await balanceDe(vault)).to.equal(await sumaRegistrada(vault));
    // Y después no puede volver a cobrar ninguna de las dos.
    await expect(atacante.attack()).to.be.revertedWithCustomError(vault, "AlreadyWithdrawn");
    await expect(atacante.attackShared()).to.be.revertedWithCustomError(vault, "AlreadyWithdrawn");
  });
});

describe("D-02 control de acceso", function () {
  it("D-02: un tercero no puede aceptar una compartida ni operar bóvedas ajenas por ID", async function () {
    const { vault, alicia, carla, id, desbloqueo } = await loadFixture(conBovedaCompartida);
    await expect(vault.connect(carla).acceptSharedVault(id))
      .to.be.revertedWithCustomError(vault, "NotInvited")
      .withArgs(id, carla.address);
    await vault.connect(carla).createVault("de Carla", desbloqueo, { value: 1n });
    await time.increaseTo(desbloqueo);
    await expect(vault.connect(alicia).withdraw(1n)).to.be.revertedWithCustomError(vault, "NotOwner");
    await expect(vault.connect(alicia).extendUnlockTime(1n, MAX_UINT64)).to.be.revertedWithCustomError(
      vault,
      "NotOwner",
    );
    // Los ID 0 no existen en ninguno de los dos espacios.
    await expect(vault.connect(alicia).withdraw(0n)).to.be.revertedWithCustomError(vault, "VaultNotFound");
    await expect(vault.connect(alicia).withdrawShared(0n)).to.be.revertedWithCustomError(vault, "VaultNotFound");
  });
});

describe("D-03 lógica 2/2", function () {
  it("D-03: aportes posteriores a las aprobaciones se retiran exactos y no se usan fondos de otra bóveda", async function () {
    const { vault, alicia, bruno, carla, id, desbloqueo } = await loadFixture(conBovedaCompartida);
    // Segunda compartida, de Bruno y Carla, con fondos que serían el botín.
    await vault.connect(bruno).createSharedVault("otra", carla.address, desbloqueo);
    await vault.connect(carla).acceptSharedVault(2n);
    await vault.connect(bruno).depositShared(2n, { value: ethers.parseEther("4") });
    await vault.connect(alicia).approveWithdrawal(id);
    await vault.connect(bruno).approveWithdrawal(id);
    await vault.connect(alicia).depositShared(id, { value: ethers.parseEther("0.2") }); // después de aprobar
    await time.increaseTo(desbloqueo);

    await expect(vault.connect(alicia).withdrawShared(2n)).to.be.revertedWithCustomError(vault, "NotParticipant");
    await expect(vault.connect(alicia).withdrawShared(id)).to.changeEtherBalance(
      ethers,
      alicia,
      ethers.parseEther("0.5"),
    );
    // Bruno retira aunque Alicia ya no esté; su retiro no depende del de ella.
    await expect(vault.connect(bruno).withdrawShared(id)).to.changeEtherBalance(
      ethers,
      bruno,
      ethers.parseEther("0.7"),
    );
    expect(await balanceDe(vault)).to.equal(ethers.parseEther("4"));
    expect(await sumaRegistrada(vault)).to.equal(ethers.parseEther("4"));
  });
});

describe("D-04 invariante contable en operación normal", function () {
  it("D-04: suma registrada == balance tras cada operación", async function () {
    const { vault, alicia, bruno, carla, desbloqueo } = await loadFixture(desplegar);
    const chequear = async () => expect(await balanceDe(vault)).to.equal(await sumaRegistrada(vault));
    const pasos: Array<() => Promise<unknown>> = [
      () => vault.connect(alicia).createVault("a", desbloqueo, { value: 7n }),
      () => vault.connect(alicia).deposit(1n, { value: 5n }),
      () => vault.connect(bruno).createSharedVault("b", carla.address, desbloqueo),
      () => vault.connect(carla).acceptSharedVault(1n),
      () => vault.connect(bruno).depositShared(1n, { value: 11n }),
      () => vault.connect(carla).depositShared(1n, { value: 13n }),
      () => vault.connect(bruno).depositShared(1n, { value: 17n }),
      () => vault.connect(carla).createSharedVault("c", alicia.address, desbloqueo),
      () => vault.connect(bruno).approveWithdrawal(1n),
      () => vault.connect(carla).approveWithdrawal(1n),
      () => time.increaseTo(desbloqueo),
      () => vault.connect(carla).withdrawShared(1n),
      () => vault.connect(alicia).withdraw(1n),
      () => vault.connect(bruno).withdrawShared(1n),
    ];
    for (const paso of pasos) {
      await paso();
      await chequear();
    }
    expect(await balanceDe(vault)).to.equal(0n);
  });
});

describe("D-05 casos límite de fecha", function () {
  it("D-05: se retira exactamente en unlockTime y no un segundo antes; crear en 'ahora' se rechaza", async function () {
    const { vault, alicia, bruno, id, desbloqueo } = await loadFixture(conBovedaCompartida);
    await vault.connect(alicia).createVault("x", desbloqueo, { value: 1n });
    await vault.connect(alicia).approveWithdrawal(id);
    await vault.connect(bruno).approveWithdrawal(id);

    await time.setNextBlockTimestamp(desbloqueo - 1n);
    await expect(vault.connect(alicia).withdraw(1n)).to.be.revertedWithCustomError(vault, "StillLocked");
    await time.setNextBlockTimestamp(desbloqueo);
    await expect(vault.connect(alicia).withdraw(1n)).to.emit(vault, "Withdrawn");
    await expect(vault.connect(alicia).withdrawShared(id)).to.emit(vault, "SharedWithdrawn");

    const ahora = BigInt(await time.latest()) + 1n;
    await time.setNextBlockTimestamp(ahora);
    await expect(vault.connect(alicia).createVault("x", ahora, { value: 1n })).to.be.revertedWithCustomError(
      vault,
      "UnlockTimeNotInFuture",
    );
  });
});

describe("D-06 montos cero", function () {
  it("D-06: depósitos de 0 se rechazan en ambos tipos de bóveda", async function () {
    const { vault, alicia, id, desbloqueo } = await loadFixture(conBovedaCompartida);
    await vault.connect(alicia).createVault("x", desbloqueo, { value: 1n });
    await expect(vault.connect(alicia).deposit(1n)).to.be.revertedWithCustomError(vault, "ZeroDeposit");
    await expect(vault.connect(alicia).depositShared(id)).to.be.revertedWithCustomError(vault, "ZeroDeposit");
  });
});
