// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RitualMazeScoreNFT
/// @notice Minimal ERC-721 score badge for Ritual Knot Maze completions on Ritual Testnet.
contract RitualMazeScoreNFT {
    struct ScoreData {
        uint256 score;
        uint256 time;
        uint256 moves;
        uint256 completedAt;
    }

    string public constant name = "Ritual Knot Maze Score";
    string public constant symbol = "RKMS";

    uint256 public totalSupply;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;
    mapping(uint256 => ScoreData) public scoreData;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event ScoreMinted(
        address indexed player, uint256 indexed tokenId, uint256 score, uint256 time, uint256 moves, uint256 completedAt
    );

    error NotTokenOwner();
    error NotApprovedOrOwner();
    error TokenDoesNotExist();
    error ZeroAddress();

    function mint(address to, uint256 score, uint256 time, uint256 moves) external returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();

        tokenId = ++totalSupply;
        _owners[tokenId] = to;
        unchecked {
            _balances[to] += 1;
        }
        scoreData[tokenId] = ScoreData({score: score, time: time, moves: moves, completedAt: block.timestamp});

        emit Transfer(address(0), to, tokenId);
        emit ScoreMinted(to, tokenId, score, time, moves, block.timestamp);
    }

    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert ZeroAddress();
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _owners[tokenId];
        if (owner == address(0)) revert TokenDoesNotExist();
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !isApprovedForAll(owner, msg.sender)) revert NotTokenOwner();
        _tokenApprovals[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        ownerOf(tokenId);
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) public view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (!_isApprovedOrOwner(msg.sender, tokenId)) revert NotApprovedOrOwner();
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
        _checkReceiver(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external {
        transferFrom(from, to, tokenId);
        _checkReceiver(from, to, tokenId, data);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        ScoreData memory s = scoreData[tokenId];
        return string.concat(
            "data:application/json;utf8,",
            "{\"name\":\"Ritual Knot Maze Score #",
            _toString(tokenId),
            "\",\"description\":\"A Ritual Knot Maze completion score minted on Ritual Testnet.\",",
            "\"attributes\":[",
            "{\"trait_type\":\"Score\",\"value\":",
            _toString(s.score),
            "},{\"trait_type\":\"Time Seconds\",\"value\":",
            _toString(s.time),
            "},{\"trait_type\":\"Moves\",\"value\":",
            _toString(s.moves),
            "},{\"trait_type\":\"Completed At\",\"display_type\":\"date\",\"value\":",
            _toString(s.completedAt),
            "}]}"
        );
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f;
    }

    function _transfer(address from, address to, uint256 tokenId) private {
        if (to == address(0)) revert ZeroAddress();
        if (ownerOf(tokenId) != from) revert NotTokenOwner();

        delete _tokenApprovals[tokenId];
        unchecked {
            _balances[from] -= 1;
            _balances[to] += 1;
        }
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) private view returns (bool) {
        address owner = ownerOf(tokenId);
        return spender == owner || getApproved(tokenId) == spender || isApprovedForAll(owner, spender);
    }

    function _checkReceiver(address from, address to, uint256 tokenId, bytes memory data) private {
        if (to.code.length == 0) return;
        (bool ok, bytes memory result) = to.call(abi.encodeWithSelector(0x150b7a02, msg.sender, from, tokenId, data));
        if (!ok || result.length != 32 || abi.decode(result, (bytes4)) != 0x150b7a02) revert NotApprovedOrOwner();
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
