// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ICurveMath} from "./interfaces/ICurveMath.sol";
import {IRoyaltyRouter} from "./interfaces/IRoyaltyRouter.sol";
import {LaunchpadConstants as C} from "./libraries/LaunchpadConstants.sol";
import {CharacterNFT} from "./CharacterNFT.sol";
import {CanonRegistry} from "./CanonRegistry.sol";
import {Graduator} from "./Graduator.sol";
import {BondingCurve} from "./BondingCurve.sol";
import {CurveDeployer} from "./deployers/CurveDeployer.sol";
import {CoinDeployer} from "./deployers/CoinDeployer.sol";

/// @title KOMA series factory
/// @notice One transaction launches a series: Character NFT (+ its Tokenbound account) for the creator, a
///         30-day linear VestingWallet for the creator's 5%, the bonding curve and the coin, and registers the
///         series with the royalty router, the canon registry and the graduator.
contract SeriesFactory is AccessControl {
    bytes32 public constant LAUNCHER_ROLE = keccak256("LAUNCHER_ROLE");

    struct LaunchParams {
        address creator;
        string name;
        string symbol;
        string characterName;
        bytes32 sheetHash;
        uint256 parentSeriesId;
        uint256 graduationTarget;
        uint64 votingWindow;
    }

    struct Series {
        address coin;
        address curve;
        address vesting;
        uint256 characterId;
        address characterAccount;
        address creator;
        uint256 parentSeriesId;
        uint256 graduationTarget;
        uint64 votingWindow;
        uint64 launchedAt;
    }

    address public immutable usdc;
    ICurveMath public immutable math;
    IRoyaltyRouter public immutable router;
    CharacterNFT public immutable characterNft;
    CanonRegistry public immutable canon;
    Graduator public immutable graduator;
    address public immutable treasury;
    CurveDeployer public immutable curveDeployer;
    CoinDeployer public immutable coinDeployer;
    /// @notice Smallest per-series graduation target / voting window the launcher may request (0 = default).
    ///         Set per chain at deploy time so testnet demo values (25 USDC, 300 s) cannot reach mainnet.
    uint256 public immutable minGraduationTarget;
    uint64 public immutable minVotingWindow;
    /// @notice Largest voting window (keeps `endsAt` far from uint64 overflow and canon slots finite).
    uint64 public constant MAX_VOTING_WINDOW = 30 days;

    mapping(uint256 id => Series) private _series;
    uint256 public seriesCount;

    event SeriesLaunched(
        uint256 indexed seriesId,
        address indexed creator,
        address coin,
        address curve,
        uint256 characterId,
        address characterAccount,
        uint256 parentSeriesId,
        uint256 graduationTarget,
        string name,
        string symbol
    );

    error ZeroAddress();
    error UnknownParent(uint256 parentSeriesId);
    error EmptyName();
    error InvalidBounds();
    error TargetTooLow(uint256 target, uint256 min);
    error InvalidVotingWindow(uint64 window);

    constructor(
        address admin,
        address usdc_,
        address math_,
        address router_,
        address characterNft_,
        address canon_,
        address graduator_,
        address treasury_,
        address curveDeployer_,
        address coinDeployer_,
        uint256 minGraduationTarget_,
        uint64 minVotingWindow_
    ) {
        if (
            usdc_ == address(0) || math_ == address(0) || router_ == address(0) || characterNft_ == address(0)
                || canon_ == address(0) || graduator_ == address(0) || treasury_ == address(0)
                || curveDeployer_ == address(0) || coinDeployer_ == address(0)
        ) revert ZeroAddress();
        // The defaults (used when a launch passes 0) must always be allowed.
        if (minGraduationTarget_ > C.DEFAULT_GRADUATION_TARGET || minVotingWindow_ > C.DEFAULT_VOTING_WINDOW) {
            revert InvalidBounds();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        minGraduationTarget = minGraduationTarget_;
        minVotingWindow = minVotingWindow_;
        usdc = usdc_;
        math = ICurveMath(math_);
        router = IRoyaltyRouter(router_);
        characterNft = CharacterNFT(characterNft_);
        canon = CanonRegistry(canon_);
        graduator = Graduator(graduator_);
        treasury = treasury_;
        curveDeployer = CurveDeployer(curveDeployer_);
        coinDeployer = CoinDeployer(coinDeployer_);
    }

    function launch(LaunchParams calldata p) external onlyRole(LAUNCHER_ROLE) returns (uint256 seriesId) {
        if (p.creator == address(0)) revert ZeroAddress();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert EmptyName();
        if (p.parentSeriesId > seriesCount) revert UnknownParent(p.parentSeriesId);

        seriesId = ++seriesCount;
        Series memory s = _deploy(p, seriesId);
        _series[seriesId] = s;

        router.registerSeries(seriesId, s.curve, s.characterAccount, p.parentSeriesId);
        canon.registerSeries(seriesId, s.coin, address(characterNft), s.characterId, s.votingWindow);
        graduator.registerCurve(seriesId, s.curve);

        emit SeriesLaunched(
            seriesId,
            p.creator,
            s.coin,
            s.curve,
            s.characterId,
            s.characterAccount,
            p.parentSeriesId,
            s.graduationTarget,
            p.name,
            p.symbol
        );
    }

    /// @dev Character NFT (+TBA) → vesting → curve → coin (mints to curve and vesting) → curve.setCoin.
    function _deploy(LaunchParams calldata p, uint256 seriesId) private returns (Series memory s) {
        s.creator = p.creator;
        s.parentSeriesId = p.parentSeriesId;
        s.graduationTarget = p.graduationTarget == 0 ? C.DEFAULT_GRADUATION_TARGET : p.graduationTarget;
        s.votingWindow = p.votingWindow == 0 ? C.DEFAULT_VOTING_WINDOW : p.votingWindow;
        if (s.graduationTarget < minGraduationTarget) revert TargetTooLow(s.graduationTarget, minGraduationTarget);
        if (s.votingWindow < minVotingWindow || s.votingWindow > MAX_VOTING_WINDOW) {
            revert InvalidVotingWindow(s.votingWindow);
        }
        s.launchedAt = uint64(block.timestamp);
        (s.characterId, s.characterAccount) = characterNft.mint(p.creator, p.characterName, p.sheetHash);
        s.vesting = coinDeployer.deployVesting(p.creator, uint64(block.timestamp), C.CREATOR_VESTING);
        s.curve = curveDeployer.deploy(
            seriesId, usdc, address(math), address(router), address(graduator), s.graduationTarget
        );
        s.coin = coinDeployer.deployCoin(p.name, p.symbol, s.curve, s.vesting);
        BondingCurve(s.curve).setCoin(s.coin);
    }

    function series(uint256 id) external view returns (Series memory) {
        return _series[id];
    }
}
