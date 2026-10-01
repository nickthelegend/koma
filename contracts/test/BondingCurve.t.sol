// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LaunchpadFixture} from "./utils/LaunchpadFixture.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {SeriesCoin} from "../src/SeriesCoin.sol";
import {SeriesFactory} from "../src/SeriesFactory.sol";
import {CurveMathReference} from "../src/CurveMathReference.sol";

contract BondingCurveTest is LaunchpadFixture {
    uint256 constant U0 = 1_000e6;
    uint256 constant C0 = 1_000_000_000e18;
    uint256 constant SNIPE_CAP = 20_000_000e18;

    uint256 id;
    BondingCurve curve;
    SeriesCoin coin;
    address characterAccount;

    uint256 buyerPk = 0xB0B;
    address buyer;

    function setUp() public override {
        super.setUp();
        (id, curve, coin) = _launch(0, 0, 0); // default 5,000 USDC target
        characterAccount = factory.series(id).characterAccount;
        buyer = vm.addr(buyerPk);
    }

    // ------------------------------------------------------------------ construction

    function test_InitialState() public view {
        (uint256 vU, uint256 vC, uint256 raised, uint256 target, bool complete, bool graduated, uint256 launchedAt) =
            curve.state();
        assertEq(vU, U0);
        assertEq(vC, C0);
        assertEq(curve.k(), U0 * C0);
        assertEq(raised, 0);
        assertEq(target, 5_000e6);
        assertFalse(complete);
        assertFalse(graduated);
        assertEq(launchedAt, block.timestamp);
        assertEq(coin.balanceOf(address(curve)), 950_000_000e18);
        assertEq(curve.spotPrice(), 1);
    }

    function test_RevertWhen_SetCoinNotFactory() public {
        vm.expectRevert(abi.encodeWithSelector(BondingCurve.Unauthorized.selector, address(this)));
        curve.setCoin(address(1));
    }

    function test_RevertWhen_SetCoinTwice() public {
        vm.prank(address(factory));
        vm.expectRevert(BondingCurve.CoinAlreadySet.selector);
        curve.setCoin(address(1));
    }

    function test_RevertWhen_TargetUnreachable() public {
        // Targets must leave 10M coins for the pool: 15,666 USDC sells 939.997M, 15,667 would sell 940.001M.
        new BondingCurve(1, address(usdc), address(math), address(router), address(graduator), 15_666e6, address(this));
        vm.expectRevert(abi.encodeWithSelector(BondingCurve.InvalidTarget.selector, 15_667e6));
        new BondingCurve(1, address(usdc), address(math), address(router), address(graduator), 15_667e6, address(this));
    }

    function test_RevertWhen_TradeBeforeCoinSet() public {
        BondingCurve bare =
            new BondingCurve(9, address(usdc), address(math), address(router), address(graduator), 25e6, address(this));
        vm.expectRevert(BondingCurve.CoinNotSet.selector);
        bare.buy(1e6, 0, address(this));
    }

    // ------------------------------------------------------------------ buys

    function test_BuyMatchesQuoteAndChargesOnePointFivePercent() public {
        _pastSnipe();
        (uint256 quoted, uint256 fee, uint256 used) = curve.quoteBuy(100e6);
        assertEq(fee, 1.5e6);
        assertEq(used, 100e6);
        assertEq(quoted, math.quoteBuy(U0, C0, 98.5e6));

        uint256 out = _buy(curve, buyer, 100e6);
        assertEq(out, quoted);
        assertEq(coin.balanceOf(buyer), out);
        assertEq(curve.raised(), 98.5e6);
        assertEq(curve.vU(), U0 + 98.5e6);
        assertEq(curve.vC(), C0 - out);
        assertEq(usdc.balanceOf(address(curve)), 98.5e6);
        // fee split 40/20/40 with no parent: character 40% + the whole 20% pool = 60%, treasury 40%
        assertEq(usdc.balanceOf(characterAccount), 0.9e6);
        assertEq(usdc.balanceOf(treasury), 0.6e6);
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function test_FeeRoundsUp() public view {
        (, uint256 fee, uint256 used) = curve.quoteBuy(101);
        assertEq(fee, 2); // ceil(1.515)
        assertEq(used, 101);
        (, fee,) = curve.quoteBuy(200);
        assertEq(fee, 3); // exactly 1.5% of 200
        (, fee,) = curve.quoteBuy(201);
        assertEq(fee, 4); // ceil(3.015)
    }

    function test_BuyEmitsTrade() public {
        _fund(buyer, 10e6);
        vm.startPrank(buyer);
        usdc.approve(address(curve), 10e6);
        (uint256 out,,) = curve.quoteBuy(10e6);
        vm.expectEmit(address(curve));
        emit BondingCurve.Trade(buyer, true, 10e6, out, 0.15e6, U0 + 9.85e6, C0 - out, 9.85e6);
        curve.buy(10e6, out, buyer);
        vm.stopPrank();
    }

    function test_RevertWhen_BuySlippage() public {
        (uint256 out,,) = curve.quoteBuy(10e6);
        _fund(buyer, 10e6);
        vm.startPrank(buyer);
        usdc.approve(address(curve), 10e6);
        vm.expectRevert(abi.encodeWithSelector(BondingCurve.Slippage.selector, out, out + 1));
        curve.buy(10e6, out + 1, buyer);
        vm.stopPrank();
    }

    function test_RevertWhen_BuyZero() public {
        vm.expectRevert(BondingCurve.ZeroAmount.selector);
        curve.buy(0, 0, buyer);
        vm.expectRevert(BondingCurve.ZeroAddress.selector);
        curve.buy(1e6, 0, address(0));
    }

    function test_BuyToOtherRecipient() public {
        address friend = makeAddr("friend");
        _fund(buyer, 5e6);
        vm.startPrank(buyer);
        usdc.approve(address(curve), 5e6);
        uint256 out = curve.buy(5e6, 0, friend);
        vm.stopPrank();
        assertEq(coin.balanceOf(friend), out);
        assertEq(coin.balanceOf(buyer), 0);
    }

    // ------------------------------------------------------------------ anti-snipe

    function test_RevertWhen_SnipeCapExceeded() public {
        // ~21M coins for 22 USDC net: over the 20M cap inside the window
        uint256 usdcIn = 23e6;
        (uint256 out,,) = curve.quoteBuy(usdcIn);
        assertGt(out, SNIPE_CAP);
        _fund(buyer, usdcIn);
        vm.startPrank(buyer);
        usdc.approve(address(curve), usdcIn);
        vm.expectRevert(abi.encodeWithSelector(BondingCurve.SnipeCap.selector, out, SNIPE_CAP));
        curve.buy(usdcIn, 0, buyer);
        vm.stopPrank();
    }

    function test_SnipeCapCountsExistingBalance() public {
        _buy(curve, buyer, 15e6); // ~14.6M coins
        (uint256 out,,) = curve.quoteBuy(8e6);
        uint256 after_ = coin.balanceOf(buyer) + out;
        assertGt(after_, SNIPE_CAP);
        _fund(buyer, 8e6);
        vm.startPrank(buyer);
        usdc.approve(address(curve), 8e6);
        vm.expectRevert(abi.encodeWithSelector(BondingCurve.SnipeCap.selector, after_, SNIPE_CAP));
        curve.buy(8e6, 0, buyer);
        vm.stopPrank();
    }

    function test_SnipeCapLiftsAfterWindow() public {
        vm.warp(curve.launchedAt() + 599);
        _fund(buyer, 23e6);
        vm.startPrank(buyer);
        usdc.approve(address(curve), 23e6);
        vm.expectPartialRevert(BondingCurve.SnipeCap.selector);
        curve.buy(23e6, 0, buyer);
        vm.warp(curve.launchedAt() + 600);
        uint256 out = curve.buy(23e6, 0, buyer);
        vm.stopPrank();
        assertGt(out, SNIPE_CAP);
    }

    // ------------------------------------------------------------------ clipping and completion

    function test_BuyClipsExactlyAtTarget() public {
        _pastSnipe();
        _buy(curve, buyer, 4_000e6); // net 3,940
        uint256 remaining = 5_000e6 - curve.raised();
        (uint256 out, uint256 fee, uint256 used) = curve.quoteBuy(2_000e6);
        assertEq(used - fee, remaining);
        assertLt(used, 2_000e6);

        address whale = makeAddr("whale");
        _fund(whale, 2_000e6);
        vm.startPrank(whale);
        usdc.approve(address(curve), 2_000e6);
        vm.expectEmit(address(curve));
        emit BondingCurve.Completed(5_000e6);
        uint256 got = curve.buy(2_000e6, 0, whale);
        vm.stopPrank();

        assertEq(got, out);
        assertEq(usdc.balanceOf(whale), 2_000e6 - used, "only the used amount is pulled");
        assertEq(curve.raised(), 5_000e6);
        assertTrue(curve.complete());
        assertEq(usdc.balanceOf(address(curve)), 5_000e6);
    }

    function testFuzz_ClipNetIsExact(uint256 raisedFirst, uint256 usdcIn) public {
        _pastSnipe();
        raisedFirst = bound(raisedFirst, 1e6, 4_900e6);
        _buy(curve, buyer, raisedFirst);
        uint256 remaining = 5_000e6 - curve.raised();
        usdcIn = bound(usdcIn, remaining + remaining / 50 + 1, 1e13);
        (, uint256 fee, uint256 used) = curve.quoteBuy(usdcIn);
        assertEq(used - fee, remaining);
        assertLe(used, usdcIn);
        // minimal: one unit less would not reach the target
        uint256 lessFee = ((used - 1) * 150 + 9_999) / 10_000; // ceil(1.5%)
        assertLt(used - 1 - lessFee, remaining);
    }

    function test_RevertWhen_TradingAfterComplete() public {
        _pastSnipe();
        _buy(curve, buyer, 6_000e6);
        assertTrue(curve.complete());
        (uint256 q,,) = curve.quoteBuy(1e6);
        assertEq(q, 0);
        (uint256 qs,) = curve.quoteSell(1e18);
        assertEq(qs, 0);

        _fund(buyer, 1e6);
        vm.startPrank(buyer);
        usdc.approve(address(curve), 1e6);
        vm.expectRevert(BondingCurve.CurveComplete.selector);
        curve.buy(1e6, 0, buyer);
        coin.approve(address(curve), 1e18);
        vm.expectRevert(BondingCurve.CurveComplete.selector);
        curve.sell(1e18, 0, buyer);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ sells

    function test_SellMatchesQuote() public {
        uint256 out = _buy(curve, buyer, 10e6);
        (uint256 quoted, uint256 fee) = curve.quoteSell(out / 2);
        uint256 gross = math.quoteSell(curve.vU(), curve.vC(), out / 2);
        assertEq(quoted + fee, gross);
        assertEq(fee, (gross * 150 + 9_999) / 10_000); // ceil(1.5%)

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.startPrank(buyer);
        coin.approve(address(curve), out / 2);
        uint256 got = curve.sell(out / 2, quoted, buyer);
        vm.stopPrank();
        assertEq(got, quoted);
        assertEq(usdc.balanceOf(buyer), quoted);
        assertEq(coin.balanceOf(buyer), out - out / 2);
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, fee * 4000 / 10000);
        assertEq(curve.raised(), usdc.balanceOf(address(curve)));
    }

    function test_RevertWhen_SellSlippage() public {
        uint256 out = _buy(curve, buyer, 10e6);
        (uint256 quoted,) = curve.quoteSell(out);
        vm.startPrank(buyer);
        coin.approve(address(curve), out);
        vm.expectRevert(abi.encodeWithSelector(BondingCurve.Slippage.selector, quoted, quoted + 1));
        curve.sell(out, quoted + 1, buyer);
        vm.stopPrank();
    }

    function test_RevertWhen_SellZero() public {
        vm.expectRevert(BondingCurve.ZeroAmount.selector);
        curve.sell(0, 0, buyer);
        vm.expectRevert(BondingCurve.ZeroAddress.selector);
        curve.sell(1, 0, address(0));
    }

    function test_RevertWhen_SellExceedsReserve() public {
        // The creator's vested coins were never bought from the curve; dumping them all into an
        // almost-empty curve would need more USDC than it holds.
        _buy(curve, buyer, 1e6);
        address vesting = factory.series(id).vesting;
        vm.prank(vesting);
        coin.transfer(creator, 50_000_000e18);
        vm.startPrank(creator);
        coin.approve(address(curve), 50_000_000e18);
        vm.expectPartialRevert(BondingCurve.InsufficientReserve.selector);
        curve.sell(50_000_000e18, 0, creator);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ gasless buy (EIP-3009)

    function _authBuy(uint256 usdcIn, uint256 minOut, uint256 deadline, bytes32 salt)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 nonce = keccak256(abi.encode(keccak256("KOMA_BUY_V1"), address(curve), buyer, usdcIn, minOut, deadline, salt));
        assertEq(nonce, curve.buyNonce(buyer, usdcIn, minOut, deadline, salt));
        return _signReceive(buyerPk, address(curve), usdcIn, 0, block.timestamp + 1 hours, nonce);
    }

    function test_BuyWithAuthorization() public {
        _fund(buyer, 10e6);
        (uint256 quoted,,) = curve.quoteBuy(10e6);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _authBuy(10e6, quoted, deadline, "salt");
        vm.prank(relayer);
        uint256 out =
            curve.buyWithAuthorization(buyer, 10e6, quoted, deadline, "salt", 0, block.timestamp + 1 hours, v, r, s);
        assertEq(out, quoted);
        assertEq(coin.balanceOf(buyer), out);
        assertEq(usdc.balanceOf(buyer), 0);
    }

    function test_RevertWhen_RelayerChangesMinOut() public {
        _fund(buyer, 10e6);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _authBuy(10e6, 1e18, deadline, "salt");
        vm.expectRevert("FiatTokenV2: invalid signature");
        curve.buyWithAuthorization(buyer, 10e6, 0, deadline, "salt", 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_RevertWhen_AuthorizationReplayed() public {
        _fund(buyer, 20e6);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _authBuy(10e6, 0, deadline, "salt");
        curve.buyWithAuthorization(buyer, 10e6, 0, deadline, "salt", 0, block.timestamp + 1 hours, v, r, s);
        vm.expectRevert("FiatTokenV2: authorization is used or canceled");
        curve.buyWithAuthorization(buyer, 10e6, 0, deadline, "salt", 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_RevertWhen_BuyDeadlinePassed() public {
        _fund(buyer, 10e6);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _authBuy(10e6, 0, deadline, "salt");
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(BondingCurve.Expired.selector, deadline));
        curve.buyWithAuthorization(buyer, 10e6, 0, deadline, "salt", 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_BuyWithAuthorizationRefundsClippedUsdc() public {
        _pastSnipe();
        _buy(curve, makeAddr("early"), 4_990e6);
        uint256 remaining = 5_000e6 - curve.raised();
        _fund(buyer, 100e6);
        (, uint256 fee, uint256 used) = curve.quoteBuy(100e6);
        assertEq(used - fee, remaining);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _authBuy(100e6, 0, deadline, bytes32(uint256(7)));
        curve.buyWithAuthorization(
            buyer, 100e6, 0, deadline, bytes32(uint256(7)), 0, block.timestamp + 1 hours, v, r, s
        );
        assertEq(usdc.balanceOf(buyer), 100e6 - used);
        assertTrue(curve.complete());
        assertEq(usdc.balanceOf(address(curve)), 5_000e6);
    }

    // ------------------------------------------------------------------ gasless sell (permit + intent)

    function _permitSig(uint256 value, uint256 deadline) internal view returns (uint8, bytes32, bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                buyer,
                address(curve),
                value,
                coin.nonces(buyer),
                deadline
            )
        );
        return vm.sign(buyerPk, keccak256(abi.encodePacked("\x19\x01", coin.DOMAIN_SEPARATOR(), structHash)));
    }

    function _intentSig(uint256 pk, uint256 coinIn, uint256 minOut, uint256 deadline, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("KOMA Curve"),
                keccak256("1"),
                block.chainid,
                address(curve)
            )
        );
        assertEq(domain, curve.DOMAIN_SEPARATOR());
        bytes32 structHash = keccak256(abi.encode(curve.SELL_TYPEHASH(), vm.addr(pk), coinIn, minOut, deadline, nonce));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function test_SellWithPermit() public {
        uint256 held = _buy(curve, buyer, 10e6);
        (uint256 quoted,) = curve.quoteSell(held);
        uint256 deadline = block.timestamp + 600;
        (uint8 pv, bytes32 pr, bytes32 ps) = _permitSig(held, deadline);
        bytes memory intent = _intentSig(buyerPk, held, quoted, deadline, 0);
        vm.prank(relayer);
        uint256 out = curve.sellWithPermit(buyer, held, quoted, deadline, pv, pr, ps, intent);
        assertEq(out, quoted);
        assertEq(usdc.balanceOf(buyer), quoted);
        assertEq(coin.balanceOf(buyer), 0);
        assertEq(curve.sellNonces(buyer), 1);
    }

    function test_SellWithPermitToleratesFrontRunPermit() public {
        uint256 held = _buy(curve, buyer, 10e6);
        uint256 deadline = block.timestamp + 600;
        (uint8 pv, bytes32 pr, bytes32 ps) = _permitSig(held, deadline);
        coin.permit(buyer, address(curve), held, deadline, pv, pr, ps); // griefer burns the permit
        bytes memory intent = _intentSig(buyerPk, held, 0, deadline, 0);
        uint256 out = curve.sellWithPermit(buyer, held, 0, deadline, pv, pr, ps, intent);
        assertGt(out, 0);
    }

    function test_RevertWhen_SellIntentSignedByOther() public {
        uint256 held = _buy(curve, buyer, 10e6);
        uint256 deadline = block.timestamp + 600;
        (uint8 pv, bytes32 pr, bytes32 ps) = _permitSig(held, deadline);
        bytes memory intent = _intentSig(0xBAD, held, 0, deadline, 0);
        vm.expectRevert(BondingCurve.InvalidIntentSignature.selector);
        curve.sellWithPermit(buyer, held, 0, deadline, pv, pr, ps, intent);
    }

    function test_RevertWhen_SellIntentReplayed() public {
        uint256 held = _buy(curve, buyer, 10e6);
        uint256 deadline = block.timestamp + 600;
        vm.prank(buyer);
        coin.approve(address(curve), type(uint256).max);
        bytes memory intent = _intentSig(buyerPk, held / 2, 0, deadline, 0);
        curve.sellWithPermit(buyer, held / 2, 0, deadline, 0, 0, 0, intent);
        vm.expectRevert(BondingCurve.InvalidIntentSignature.selector);
        curve.sellWithPermit(buyer, held / 2, 0, deadline, 0, 0, 0, intent);
    }

    /// AUDIT.md L-3: a seller can cancel an outstanding signed intent before its deadline.
    function test_InvalidateSellNonceCancelsSignedIntent() public {
        uint256 held = _buy(curve, buyer, 10e6);
        uint256 deadline = block.timestamp + 600;
        vm.prank(buyer);
        coin.approve(address(curve), type(uint256).max);
        bytes memory intent = _intentSig(buyerPk, held, 0, deadline, 0);
        vm.expectEmit(address(curve));
        emit BondingCurve.SellNonceInvalidated(buyer, 0);
        vm.prank(buyer);
        curve.invalidateSellNonce();
        assertEq(curve.sellNonces(buyer), 1);
        vm.prank(relayer);
        vm.expectRevert(BondingCurve.InvalidIntentSignature.selector);
        curve.sellWithPermit(buyer, held, 0, deadline, 0, 0, 0, intent);
        // a fresh intent for the next nonce works
        intent = _intentSig(buyerPk, held, 0, deadline, 1);
        vm.prank(relayer);
        assertGt(curve.sellWithPermit(buyer, held, 0, deadline, 0, 0, 0, intent), 0);
    }

    function test_RevertWhen_SellNoPermitNoAllowance() public {
        uint256 held = _buy(curve, buyer, 10e6);
        uint256 deadline = block.timestamp + 600;
        bytes memory intent = _intentSig(buyerPk, held, 0, deadline, 0);
        vm.expectRevert(abi.encodeWithSelector(BondingCurve.InsufficientAllowance.selector, 0, held));
        curve.sellWithPermit(buyer, held, 0, deadline, 0, 0, 0, intent);
    }

    function test_RevertWhen_SellDeadlinePassed() public {
        uint256 deadline = block.timestamp - 1;
        vm.expectRevert(abi.encodeWithSelector(BondingCurve.Expired.selector, deadline));
        curve.sellWithPermit(buyer, 1, 0, deadline, 0, 0, 0, "");
    }

    // ------------------------------------------------------------------ graduation

    function test_RevertWhen_GraduateBeforeComplete() public {
        vm.expectRevert(BondingCurve.NotComplete.selector);
        curve.graduate();
    }

    function test_GraduateOnce() public {
        _pastSnipe();
        _buy(curve, buyer, 6_000e6);
        curve.graduate();
        assertTrue(curve.graduated());
        vm.expectRevert(BondingCurve.AlreadyGraduated.selector);
        curve.graduate();
    }

    // ------------------------------------------------------------------ fuzz / invariants

    function testFuzz_PriceMonotonicInBuys(uint256 a, uint256 b) public {
        _pastSnipe();
        a = bound(a, 1e3, 2_000e6);
        b = bound(b, 1e3, 2_000e6);
        uint256 p0 = curve.vU() * 1e36 / curve.vC();
        _buy(curve, buyer, a);
        uint256 p1 = curve.vU() * 1e36 / curve.vC();
        _buy(curve, buyer, b);
        uint256 p2 = curve.vU() * 1e36 / curve.vC();
        assertGt(p1, p0);
        assertGt(p2, p1);
        assertGe(curve.spotPrice(), 1);
    }

    function testFuzz_RoundTripNeverProfits(uint256 usdcIn, uint256 priorRaise) public {
        _pastSnipe();
        priorRaise = bound(priorRaise, 0, 4_000e6);
        if (priorRaise > 1e3) _buy(curve, makeAddr("prior"), priorRaise);
        usdcIn = bound(usdcIn, 100, 900e6);
        uint256 out = _buy(curve, buyer, usdcIn);
        vm.startPrank(buyer);
        coin.approve(address(curve), out);
        (uint256 quoted,) = curve.quoteSell(out);
        if (quoted == 0) return;
        uint256 back = curve.sell(out, 0, buyer);
        vm.stopPrank();
        assertLe(back, usdcIn);
    }

    /// The curve's USDC always covers selling every coin it has sold, in any order.
    function testFuzz_SolventAfterRandomTrades(uint256 seed) public {
        _pastSnipe();
        address[3] memory traders = [makeAddr("t0"), makeAddr("t1"), makeAddr("t2")];
        for (uint256 i; i < 12; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            address t = traders[seed % 3];
            if (curve.complete()) break;
            if ((seed >> 8) % 3 != 0 || coin.balanceOf(t) == 0) {
                _buy(curve, t, bound(seed >> 16, 1e4, 800e6));
            } else {
                uint256 amt = bound(seed >> 16, 1, coin.balanceOf(t));
                (uint256 q,) = curve.quoteSell(amt);
                if (q == 0) continue;
                vm.startPrank(t);
                coin.approve(address(curve), amt);
                curve.sell(amt, 0, t);
                vm.stopPrank();
            }
            assertEq(curve.raised(), curve.vU() - U0);
            assertEq(usdc.balanceOf(address(curve)), curve.raised());
        }
        if (curve.complete()) return;
        uint256 sold = C0 - curve.vC();
        uint256 owed = math.quoteSell(curve.vU(), curve.vC(), sold);
        assertLe(owed, usdc.balanceOf(address(curve)));
        // and one by one
        for (uint256 i; i < 3; i++) {
            uint256 bal = coin.balanceOf(traders[i]);
            (uint256 q,) = curve.quoteSell(bal);
            if (bal == 0 || q == 0) continue;
            vm.startPrank(traders[i]);
            coin.approve(address(curve), bal);
            curve.sell(bal, 0, traders[i]);
            vm.stopPrank();
        }
        assertEq(usdc.balanceOf(address(curve)), curve.raised());
    }
}
