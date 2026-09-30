// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC6551Registry, ITokenboundAccountProxy} from "./interfaces/ILaunchpad.sol";

/// @title KOMA characters
/// @notice One ERC-721 per series protagonist. Each token owns an ERC-6551 Tokenbound account that
///         collects the character's share of every trading fee, so whoever holds the NFT holds the earnings.
contract CharacterNFT is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    IERC6551Registry public immutable registry;
    address public immutable accountProxy;
    address public immutable accountImpl;

    struct Character {
        address account;
        bytes32 sheetHash;
        string name;
    }

    mapping(uint256 id => Character) private _characters;
    uint256 public totalMinted;
    string private _base;

    event CharacterMinted(uint256 indexed id, address indexed to, address account, bytes32 sheetHash, string name);
    event BaseURIUpdated(string baseURI);

    error UnknownCharacter(uint256 id);

    constructor(address admin, address registry_, address accountProxy_, address accountImpl_, string memory baseURI_)
        ERC721("KOMA Characters", "KCHAR")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        registry = IERC6551Registry(registry_);
        accountProxy = accountProxy_;
        accountImpl = accountImpl_;
        _base = baseURI_;
    }

    function mint(address to, string calldata name_, bytes32 sheetHash_)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 id, address account)
    {
        id = ++totalMinted;
        _mint(to, id);
        account = registry.createAccount(accountProxy, bytes32(0), block.chainid, address(this), id);
        // The registry is permissionless, so the account may already exist and be initialized; the proxy
        // only accepts guardian-trusted implementations, so an earlier initialize is harmless.
        try ITokenboundAccountProxy(account).initialize(accountImpl) {} catch {}
        _characters[id] = Character(account, sheetHash_, name_);
        emit CharacterMinted(id, to, account, sheetHash_, name_);
    }

    function accountOf(uint256 id) external view returns (address) {
        return _known(id).account;
    }

    function sheetHash(uint256 id) external view returns (bytes32) {
        return _known(id).sheetHash;
    }

    function nameOf(uint256 id) external view returns (string memory) {
        return _known(id).name;
    }

    function setBaseURI(string calldata baseURI_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _base = baseURI_;
        emit BaseURIUpdated(baseURI_);
    }

    function _baseURI() internal view override returns (string memory) {
        return _base;
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return string.concat(_base, Strings.toString(id));
    }

    function supportsInterface(bytes4 id) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(id);
    }

    function _known(uint256 id) private view returns (Character storage c) {
        c = _characters[id];
        if (c.account == address(0)) revert UnknownCharacter(id);
    }
}
