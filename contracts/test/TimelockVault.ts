import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { time, loadFixture } = networkHelpers;

const DIA = 24 * 60 * 60;
const MAX_UINT64 = 2n ** 64n - 1n;

async function desplegar() {
  const [alicia, bruno, carla] = await ethers.getSigners();
  const vault = await ethers.deployContract("TimelockVault");
  const ahora = await time.latest();
  const desbloqueo = BigInt(ahora + 30 * DIA);
  return { vault, alicia, bruno, carla, desbloqueo };
}

async function conBovedaIndividual() {
  const base = await desplegar();
  const { vault, alicia, desbloqueo } = base;
  await vault.connect(alicia).createVault("Viaje a Japón", desbloqueo, { value: ethers.parseEther("1") });
  return { ...base, id: 1n };
}

async function conBovedaCompartida() {
  const base = await desplegar();
  const { vault, alicia, bruno, desbloqueo } = base;
  await vault.connect(alicia).createSharedVault("Ahorro para la casa", bruno.address, desbloqueo);
  await vault.connect(bruno).acceptSharedVault(1n);
  await vault.connect(alicia).depositShared(1n, { value: ethers.parseEther("0.3") });
  await vault.connect(bruno).depositShared(1n, { value: ethers.parseEther("0.7") });
  return { ...base, id: 1n };
}

describe("TimelockVault: bóveda individual", function () {
  it("crea la bóveda con nombre, fecha y primer depósito", async function () {
    const { vault, alicia, desbloqueo } = await loadFixture(desplegar);
    const valor = ethers.parseEther("1");

    await expect(vault.connect(alicia).createVault("Viaje a Japón", desbloqueo, { value: valor }))
      .to.emit(vault, "VaultCreated")
      .withArgs(1n, alicia.address, "Viaje a Japón", desbloqueo)
      .and.to.emit(vault, "Deposited")
      .withArgs(1n, alicia.address, valor, valor);

    const v = await vault.getVaultDetails(1n);
    expect(v.owner).to.equal(alicia.address);
    expect(v.balance).to.equal(valor);
    expect(v.unlockTime).to.equal(desbloqueo);
    expect(v.withdrawn).to.equal(false);
    expect(await vault.getVaultsOf(alicia.address)).to.deep.equal([1n]);
  });

  it("un mismo titular puede tener varias bóvedas", async function () {
    const { vault, alicia, desbloqueo } = await loadFixture(conBovedaIndividual);
    await vault.connect(alicia).createVault("Fondo de emergencia", desbloqueo + 10n, { value: 1n });
    expect(await vault.getVaultsOf(alicia.address)).to.deep.equal([1n, 2n]);
  });

  it("rechaza crear sin depósito, sin nombre, con nombre largo o con fecha pasada", async function () {
    const { vault, alicia, desbloqueo } = await loadFixture(desplegar);
    await expect(vault.connect(alicia).createVault("x", desbloqueo)).to.be.revertedWithCustomError(
      vault,
      "ZeroDeposit",
    );
    await expect(vault.connect(alicia).createVault("", desbloqueo, { value: 1n })).to.be.revertedWithCustomError(
      vault,
      "InvalidName",
    );
    await expect(
      vault.connect(alicia).createVault("a".repeat(65), desbloqueo, { value: 1n }),
    ).to.be.revertedWithCustomError(vault, "InvalidName");
    const pasado = BigInt(await time.latest());
    await expect(vault.connect(alicia).createVault("x", pasado, { value: 1n }))
      .to.be.revertedWithCustomError(vault, "UnlockTimeNotInFuture")
      .withArgs(pasado);
  });

  it("el titular suma depósitos y la fecha no cambia", async function () {
    const { vault, alicia, id, desbloqueo } = await loadFixture(conBovedaIndividual);
    await expect(vault.connect(alicia).deposit(id, { value: ethers.parseEther("0.5") }))
      .to.emit(vault, "Deposited")
      .withArgs(id, alicia.address, ethers.parseEther("0.5"), ethers.parseEther("1.5"));
    const v = await vault.getVaultDetails(id);
    expect(v.balance).to.equal(ethers.parseEther("1.5"));
    expect(v.unlockTime).to.equal(desbloqueo);
  });

  it("solo el titular deposita, posterga o retira", async function () {
    const { vault, bruno, id, desbloqueo } = await loadFixture(conBovedaIndividual);
    await expect(vault.connect(bruno).deposit(id, { value: 1n }))
      .to.be.revertedWithCustomError(vault, "NotOwner")
      .withArgs(id, bruno.address);
    await expect(vault.connect(bruno).extendUnlockTime(id, desbloqueo + 1n)).to.be.revertedWithCustomError(
      vault,
      "NotOwner",
    );
    await time.increaseTo(desbloqueo);
    await expect(vault.connect(bruno).withdraw(id)).to.be.revertedWithCustomError(vault, "NotOwner");
  });

  it("la fecha solo se puede postergar, nunca adelantar", async function () {
    const { vault, alicia, id, desbloqueo } = await loadFixture(conBovedaIndividual);
    await expect(vault.connect(alicia).extendUnlockTime(id, desbloqueo - 1n))
      .to.be.revertedWithCustomError(vault, "UnlockTimeNotLater")
      .withArgs(desbloqueo, desbloqueo - 1n);
    await expect(vault.connect(alicia).extendUnlockTime(id, desbloqueo)).to.be.revertedWithCustomError(
      vault,
      "UnlockTimeNotLater",
    );
    await expect(vault.connect(alicia).extendUnlockTime(id, desbloqueo + BigInt(DIA)))
      .to.emit(vault, "UnlockTimeExtended")
      .withArgs(id, desbloqueo, desbloqueo + BigInt(DIA));
  });

  it("rechaza el retiro antes de la fecha", async function () {
    const { vault, alicia, id, desbloqueo } = await loadFixture(conBovedaIndividual);
    await expect(vault.connect(alicia).withdraw(id))
      .to.be.revertedWithCustomError(vault, "StillLocked")
      .withArgs(desbloqueo);
  });

  it("al llegar la fecha, el titular retira todo el saldo", async function () {
    const { vault, alicia, id, desbloqueo } = await loadFixture(conBovedaIndividual);
    await time.increaseTo(desbloqueo);
    const valor = ethers.parseEther("1");

    const tx = vault.connect(alicia).withdraw(id);
    await expect(tx).to.emit(vault, "Withdrawn").withArgs(id, alicia.address, valor);
    await expect(tx).to.changeEtherBalances(ethers, [alicia, vault], [valor, -valor]);

    const v = await vault.getVaultDetails(id);
    expect(v.balance).to.equal(0n);
    expect(v.withdrawn).to.equal(true);
  });

  it("no permite retirar dos veces ni depositar en una bóveda ya retirada", async function () {
    const { vault, alicia, id, desbloqueo } = await loadFixture(conBovedaIndividual);
    await time.increaseTo(desbloqueo);
    await vault.connect(alicia).withdraw(id);
    await expect(vault.connect(alicia).withdraw(id)).to.be.revertedWithCustomError(vault, "AlreadyWithdrawn");
    await expect(vault.connect(alicia).deposit(id, { value: 1n })).to.be.revertedWithCustomError(
      vault,
      "AlreadyWithdrawn",
    );
  });

  it("una bóveda inexistente da error claro", async function () {
    const { vault, alicia } = await loadFixture(desplegar);
    await expect(vault.getVaultDetails(99n)).to.be.revertedWithCustomError(vault, "VaultNotFound").withArgs(99n);
    await expect(vault.connect(alicia).deposit(99n, { value: 1n })).to.be.revertedWithCustomError(
      vault,
      "VaultNotFound",
    );
  });

  it("bloquea la reentrancia: el atacante cobra una sola vez", async function () {
    const { vault, desbloqueo } = await loadFixture(desplegar);
    const atacante = await ethers.deployContract("ReentrancyAttacker", [await vault.getAddress()]);
    const valor = ethers.parseEther("1");
    await atacante.createVault(desbloqueo, { value: valor });
    // Otro titular deja fondos en el contrato, que serían el botín de una reentrancia.
    const [, , carla] = await ethers.getSigners();
    await vault.connect(carla).createVault("de otra persona", desbloqueo, { value: ethers.parseEther("5") });
    await time.increaseTo(desbloqueo);

    await expect(atacante.attack()).to.changeEtherBalances(ethers, [atacante, vault], [valor, -valor]);
    expect(await atacante.reentryAttempted()).to.equal(true);
    expect(await atacante.reentrySucceeded()).to.equal(false);
  });

  it("si la transferencia falla, revierte y el saldo queda intacto", async function () {
    const { vault, desbloqueo } = await loadFixture(desplegar);
    const receptor = await ethers.deployContract("RejectingReceiver", [await vault.getAddress()]);
    await receptor.createVault(desbloqueo, { value: ethers.parseEther("1") });
    await time.increaseTo(desbloqueo);

    await expect(receptor.withdraw()).to.be.revertedWithCustomError(vault, "TransferFailed");
    const v = await vault.getVaultDetails(1n);
    expect(v.balance).to.equal(ethers.parseEther("1"));
    expect(v.withdrawn).to.equal(false);
  });
});

describe("TimelockVault: bóveda compartida (2/2)", function () {
  it("crea la bóveda pendiente, el invitado la acepta y cada aporte se registra por separado", async function () {
    const { vault, alicia, bruno, desbloqueo } = await loadFixture(desplegar);
    await expect(vault.connect(alicia).createSharedVault("Ahorro para la casa", bruno.address, desbloqueo))
      .to.emit(vault, "SharedVaultCreated")
      .withArgs(1n, alicia.address, bruno.address, "Ahorro para la casa", desbloqueo);

    let s = await vault.getSharedVaultDetails(1n);
    expect(s.accepted).to.equal(false);
    expect(await vault.getSharedVaultsOf(alicia.address)).to.deep.equal([1n]);
    expect(await vault.getSharedVaultsOf(bruno.address)).to.deep.equal([]);

    await expect(vault.connect(bruno).acceptSharedVault(1n))
      .to.emit(vault, "SharedVaultAccepted")
      .withArgs(1n, bruno.address);
    expect(await vault.getSharedVaultsOf(bruno.address)).to.deep.equal([1n]);

    await expect(vault.connect(alicia).depositShared(1n, { value: ethers.parseEther("0.3") }))
      .to.emit(vault, "SharedDeposited")
      .withArgs(1n, alicia.address, ethers.parseEther("0.3"), ethers.parseEther("0.3"));
    await vault.connect(bruno).depositShared(1n, { value: ethers.parseEther("0.7") });

    s = await vault.getSharedVaultDetails(1n);
    expect(s.participants).to.deep.equal([alicia.address, bruno.address]);
    expect(s.accepted).to.equal(true);
    expect(s.contributions).to.deep.equal([ethers.parseEther("0.3"), ethers.parseEther("0.7")]);
    expect(s.approved).to.deep.equal([false, false]);
  });

  it("crear no admite ETH, y antes de aceptar nadie puede aportar ni aprobar", async function () {
    const { vault, alicia, bruno, desbloqueo } = await loadFixture(desplegar);
    // createSharedVault no es payable: se arma la transacción a mano para mandarle valor.
    const data = vault.interface.encodeFunctionData("createSharedVault", ["x", bruno.address, desbloqueo]);
    await expect(alicia.sendTransaction({ to: await vault.getAddress(), data, value: 1n })).to.revert(ethers);

    await vault.connect(alicia).createSharedVault("x", bruno.address, desbloqueo);
    for (const titular of [alicia, bruno]) {
      await expect(vault.connect(titular).depositShared(1n, { value: 1n })).to.be.revertedWithCustomError(
        vault,
        "NotAccepted",
      );
      await expect(vault.connect(titular).approveWithdrawal(1n)).to.be.revertedWithCustomError(vault, "NotAccepted");
    }
  });

  it("solo el invitado acepta, y una sola vez", async function () {
    const { vault, alicia, bruno, carla, desbloqueo } = await loadFixture(desplegar);
    await vault.connect(alicia).createSharedVault("x", bruno.address, desbloqueo);
    await expect(vault.connect(carla).acceptSharedVault(1n))
      .to.be.revertedWithCustomError(vault, "NotInvited")
      .withArgs(1n, carla.address);
    await expect(vault.connect(alicia).acceptSharedVault(1n))
      .to.be.revertedWithCustomError(vault, "NotInvited")
      .withArgs(1n, alicia.address);
    await expect(vault.connect(bruno).acceptSharedVault(99n)).to.be.revertedWithCustomError(vault, "VaultNotFound");
    await vault.connect(bruno).acceptSharedVault(1n);
    await expect(vault.connect(bruno).acceptSharedVault(1n)).to.be.revertedWithCustomError(vault, "AlreadyAccepted");
    expect(await vault.getSharedVaultsOf(bruno.address)).to.deep.equal([1n]);
  });

  it("rechaza un segundo titular inválido", async function () {
    const { vault, alicia, desbloqueo } = await loadFixture(desplegar);
    await expect(vault.connect(alicia).createSharedVault("x", ethers.ZeroAddress, desbloqueo))
      .to.be.revertedWithCustomError(vault, "InvalidPartner")
      .withArgs(ethers.ZeroAddress);
    await expect(
      vault.connect(alicia).createSharedVault("x", alicia.address, desbloqueo),
    ).to.be.revertedWithCustomError(vault, "InvalidPartner");
    const contrato = await vault.getAddress();
    await expect(vault.connect(alicia).createSharedVault("x", contrato, desbloqueo))
      .to.be.revertedWithCustomError(vault, "InvalidPartner")
      .withArgs(contrato);
  });

  it("solo los titulares aportan, aprueban o retiran", async function () {
    const { vault, carla, id, desbloqueo } = await loadFixture(conBovedaCompartida);
    await expect(vault.connect(carla).depositShared(id, { value: 1n }))
      .to.be.revertedWithCustomError(vault, "NotParticipant")
      .withArgs(id, carla.address);
    await expect(vault.connect(carla).approveWithdrawal(id)).to.be.revertedWithCustomError(vault, "NotParticipant");
    await time.increaseTo(desbloqueo);
    await expect(vault.connect(carla).withdrawShared(id)).to.be.revertedWithCustomError(vault, "NotParticipant");
  });

  it("con las dos aprobaciones pero antes de la fecha, no se puede retirar", async function () {
    const { vault, alicia, bruno, id, desbloqueo } = await loadFixture(conBovedaCompartida);
    await vault.connect(alicia).approveWithdrawal(id);
    await vault.connect(bruno).approveWithdrawal(id);
    await expect(vault.connect(alicia).withdrawShared(id))
      .to.be.revertedWithCustomError(vault, "StillLocked")
      .withArgs(desbloqueo);
  });

  it("después de la fecha, una sola aprobación no alcanza", async function () {
    const { vault, alicia, id, desbloqueo } = await loadFixture(conBovedaCompartida);
    await expect(vault.connect(alicia).approveWithdrawal(id))
      .to.emit(vault, "WithdrawalApproved")
      .withArgs(id, alicia.address);
    await time.increaseTo(desbloqueo);
    await expect(vault.connect(alicia).withdrawShared(id)).to.be.revertedWithCustomError(vault, "MissingApprovals");
  });

  it("no se aprueba dos veces", async function () {
    const { vault, alicia, id } = await loadFixture(conBovedaCompartida);
    await vault.connect(alicia).approveWithdrawal(id);
    await expect(vault.connect(alicia).approveWithdrawal(id)).to.be.revertedWithCustomError(vault, "AlreadyApproved");
  });

  it("con 2/2 y la fecha cumplida, cada uno retira lo que aportó (0,3 y 0,7)", async function () {
    const { vault, alicia, bruno, id, desbloqueo } = await loadFixture(conBovedaCompartida);
    await vault.connect(alicia).approveWithdrawal(id);
    await vault.connect(bruno).approveWithdrawal(id);
    await time.increaseTo(desbloqueo);

    const aporteA = ethers.parseEther("0.3");
    const aporteB = ethers.parseEther("0.7");
    const txA = vault.connect(alicia).withdrawShared(id);
    await expect(txA).to.emit(vault, "SharedWithdrawn").withArgs(id, alicia.address, aporteA);
    await expect(txA).to.changeEtherBalances(ethers, [alicia, vault], [aporteA, -aporteA]);
    await expect(vault.connect(bruno).withdrawShared(id)).to.changeEtherBalances(
      ethers,
      [bruno, vault],
      [aporteB, -aporteB],
    );

    const s = await vault.getSharedVaultDetails(id);
    expect(s.contributions).to.deep.equal([0n, 0n]);
    expect(s.withdrawn).to.deep.equal([true, true]);
  });

  it("no permite retirar dos veces ni aportar después de retirar", async function () {
    const { vault, alicia, bruno, id, desbloqueo } = await loadFixture(conBovedaCompartida);
    await vault.connect(alicia).approveWithdrawal(id);
    await vault.connect(bruno).approveWithdrawal(id);
    await time.increaseTo(desbloqueo);
    await vault.connect(alicia).withdrawShared(id);
    await expect(vault.connect(alicia).withdrawShared(id)).to.be.revertedWithCustomError(vault, "AlreadyWithdrawn");
    await expect(vault.connect(alicia).depositShared(id, { value: 1n })).to.be.revertedWithCustomError(
      vault,
      "AlreadyWithdrawn",
    );
  });

  it("un titular que no aportó no tiene nada para retirar", async function () {
    const { vault, alicia, bruno, desbloqueo } = await loadFixture(desplegar);
    await vault.connect(alicia).createSharedVault("x", bruno.address, desbloqueo);
    await vault.connect(bruno).acceptSharedVault(1n);
    await vault.connect(alicia).depositShared(1n, { value: 1n });
    await vault.connect(alicia).approveWithdrawal(1n);
    await vault.connect(bruno).approveWithdrawal(1n);
    await time.increaseTo(desbloqueo);
    await expect(vault.connect(bruno).withdrawShared(1n)).to.be.revertedWithCustomError(vault, "NothingToWithdraw");
  });

  it("la fecha compartida queda fija desde la creación (R-03)", async function () {
    const { vault, alicia, bruno, id, desbloqueo } = await loadFixture(conBovedaCompartida);
    // Ya no existe ninguna función para cambiarla.
    expect(vault.interface.hasFunction("extendSharedUnlockTime")).to.equal(false);
    expect(vault.interface.hasEvent("SharedUnlockTimeExtended")).to.equal(false);

    // El ataque de R-03: Bruno, ya vencida la fecha, intenta re-bloquearla hasta 2^64-1
    // llamando a la función eliminada por su selector. La llamada revierte.
    await time.increaseTo(desbloqueo + 1n);
    const viejo = new ethers.Interface(["function extendSharedUnlockTime(uint256,uint64)"]);
    await expect(
      bruno.sendTransaction({
        to: await vault.getAddress(),
        data: viejo.encodeFunctionData("extendSharedUnlockTime", [id, MAX_UINT64]),
      }),
    ).to.revert(ethers);

    await vault.connect(alicia).approveWithdrawal(id);
    await vault.connect(bruno).approveWithdrawal(id);
    expect((await vault.getSharedVaultDetails(id)).unlockTime).to.equal(desbloqueo);
    await expect(vault.connect(alicia).withdrawShared(id)).to.changeEtherBalance(
      ethers,
      alicia,
      ethers.parseEther("0.3"),
    );
  });

  it("bloquea la reentrancia en el retiro compartido", async function () {
    const { vault, bruno, desbloqueo } = await loadFixture(desplegar);
    const atacante = await ethers.deployContract("ReentrancyAttacker", [await vault.getAddress()]);
    const aporte = ethers.parseEther("1");
    await atacante.createSharedVault(bruno.address, desbloqueo);
    await vault.connect(bruno).acceptSharedVault(1n);
    await atacante.depositShared({ value: aporte });
    await vault.connect(bruno).depositShared(1n, { value: ethers.parseEther("2") });
    await atacante.approveShared();
    await vault.connect(bruno).approveWithdrawal(1n);
    await time.increaseTo(desbloqueo);

    await expect(atacante.attackShared()).to.changeEtherBalances(ethers, [atacante, vault], [aporte, -aporte]);
    expect(await atacante.reentryAttempted()).to.equal(true);
    expect(await atacante.reentrySucceeded()).to.equal(false);
    // El aporte de Bruno sigue intacto.
    const s = await vault.getSharedVaultDetails(1n);
    expect(s.contributions[1]).to.equal(ethers.parseEther("2"));
  });
});
