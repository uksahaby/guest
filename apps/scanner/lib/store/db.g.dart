// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'db.dart';

// ignore_for_file: type=lint
class $InvitationsTable extends Invitations
    with TableInfo<$InvitationsTable, Invitation> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $InvitationsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _passIdMeta = const VerificationMeta('passId');
  @override
  late final GeneratedColumn<String> passId = GeneratedColumn<String>(
    'pass_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _legIdMeta = const VerificationMeta('legId');
  @override
  late final GeneratedColumn<String> legId = GeneratedColumn<String>(
    'leg_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _displayNameMeta = const VerificationMeta(
    'displayName',
  );
  @override
  late final GeneratedColumn<String> displayName = GeneratedColumn<String>(
    'display_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _categoryMeta = const VerificationMeta(
    'category',
  );
  @override
  late final GeneratedColumn<String> category = GeneratedColumn<String>(
    'category',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _tableLabelMeta = const VerificationMeta(
    'tableLabel',
  );
  @override
  late final GeneratedColumn<String> tableLabel = GeneratedColumn<String>(
    'table_label',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _allowanceMeta = const VerificationMeta(
    'allowance',
  );
  @override
  late final GeneratedColumn<int> allowance = GeneratedColumn<int>(
    'allowance',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _admittedSyncedMeta = const VerificationMeta(
    'admittedSynced',
  );
  @override
  late final GeneratedColumn<int> admittedSynced = GeneratedColumn<int>(
    'admitted_synced',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _rsvpMeta = const VerificationMeta('rsvp');
  @override
  late final GeneratedColumn<String> rsvp = GeneratedColumn<String>(
    'rsvp',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _searchTermsMeta = const VerificationMeta(
    'searchTerms',
  );
  @override
  late final GeneratedColumn<String> searchTerms = GeneratedColumn<String>(
    'search_terms',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    passId,
    legId,
    displayName,
    category,
    tableLabel,
    allowance,
    admittedSynced,
    rsvp,
    searchTerms,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'invitations';
  @override
  VerificationContext validateIntegrity(
    Insertable<Invitation> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('pass_id')) {
      context.handle(
        _passIdMeta,
        passId.isAcceptableOrUnknown(data['pass_id']!, _passIdMeta),
      );
    } else if (isInserting) {
      context.missing(_passIdMeta);
    }
    if (data.containsKey('leg_id')) {
      context.handle(
        _legIdMeta,
        legId.isAcceptableOrUnknown(data['leg_id']!, _legIdMeta),
      );
    } else if (isInserting) {
      context.missing(_legIdMeta);
    }
    if (data.containsKey('display_name')) {
      context.handle(
        _displayNameMeta,
        displayName.isAcceptableOrUnknown(
          data['display_name']!,
          _displayNameMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_displayNameMeta);
    }
    if (data.containsKey('category')) {
      context.handle(
        _categoryMeta,
        category.isAcceptableOrUnknown(data['category']!, _categoryMeta),
      );
    }
    if (data.containsKey('table_label')) {
      context.handle(
        _tableLabelMeta,
        tableLabel.isAcceptableOrUnknown(data['table_label']!, _tableLabelMeta),
      );
    }
    if (data.containsKey('allowance')) {
      context.handle(
        _allowanceMeta,
        allowance.isAcceptableOrUnknown(data['allowance']!, _allowanceMeta),
      );
    } else if (isInserting) {
      context.missing(_allowanceMeta);
    }
    if (data.containsKey('admitted_synced')) {
      context.handle(
        _admittedSyncedMeta,
        admittedSynced.isAcceptableOrUnknown(
          data['admitted_synced']!,
          _admittedSyncedMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_admittedSyncedMeta);
    }
    if (data.containsKey('rsvp')) {
      context.handle(
        _rsvpMeta,
        rsvp.isAcceptableOrUnknown(data['rsvp']!, _rsvpMeta),
      );
    } else if (isInserting) {
      context.missing(_rsvpMeta);
    }
    if (data.containsKey('search_terms')) {
      context.handle(
        _searchTermsMeta,
        searchTerms.isAcceptableOrUnknown(
          data['search_terms']!,
          _searchTermsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_searchTermsMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {passId, legId};
  @override
  Invitation map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return Invitation(
      passId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}pass_id'],
      )!,
      legId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}leg_id'],
      )!,
      displayName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}display_name'],
      )!,
      category: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}category'],
      ),
      tableLabel: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}table_label'],
      ),
      allowance: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}allowance'],
      )!,
      admittedSynced: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}admitted_synced'],
      )!,
      rsvp: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}rsvp'],
      )!,
      searchTerms: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}search_terms'],
      )!,
    );
  }

  @override
  $InvitationsTable createAlias(String alias) {
    return $InvitationsTable(attachedDatabase, alias);
  }
}

class Invitation extends DataClass implements Insertable<Invitation> {
  final String passId;
  final String legId;
  final String displayName;
  final String? category;
  final String? tableLabel;
  final int allowance;

  /// The server's admitted sum as of the last bootstrap.
  final int admittedSynced;
  final String rsvp;
  final String searchTerms;
  const Invitation({
    required this.passId,
    required this.legId,
    required this.displayName,
    this.category,
    this.tableLabel,
    required this.allowance,
    required this.admittedSynced,
    required this.rsvp,
    required this.searchTerms,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['pass_id'] = Variable<String>(passId);
    map['leg_id'] = Variable<String>(legId);
    map['display_name'] = Variable<String>(displayName);
    if (!nullToAbsent || category != null) {
      map['category'] = Variable<String>(category);
    }
    if (!nullToAbsent || tableLabel != null) {
      map['table_label'] = Variable<String>(tableLabel);
    }
    map['allowance'] = Variable<int>(allowance);
    map['admitted_synced'] = Variable<int>(admittedSynced);
    map['rsvp'] = Variable<String>(rsvp);
    map['search_terms'] = Variable<String>(searchTerms);
    return map;
  }

  InvitationsCompanion toCompanion(bool nullToAbsent) {
    return InvitationsCompanion(
      passId: Value(passId),
      legId: Value(legId),
      displayName: Value(displayName),
      category: category == null && nullToAbsent
          ? const Value.absent()
          : Value(category),
      tableLabel: tableLabel == null && nullToAbsent
          ? const Value.absent()
          : Value(tableLabel),
      allowance: Value(allowance),
      admittedSynced: Value(admittedSynced),
      rsvp: Value(rsvp),
      searchTerms: Value(searchTerms),
    );
  }

  factory Invitation.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return Invitation(
      passId: serializer.fromJson<String>(json['passId']),
      legId: serializer.fromJson<String>(json['legId']),
      displayName: serializer.fromJson<String>(json['displayName']),
      category: serializer.fromJson<String?>(json['category']),
      tableLabel: serializer.fromJson<String?>(json['tableLabel']),
      allowance: serializer.fromJson<int>(json['allowance']),
      admittedSynced: serializer.fromJson<int>(json['admittedSynced']),
      rsvp: serializer.fromJson<String>(json['rsvp']),
      searchTerms: serializer.fromJson<String>(json['searchTerms']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'passId': serializer.toJson<String>(passId),
      'legId': serializer.toJson<String>(legId),
      'displayName': serializer.toJson<String>(displayName),
      'category': serializer.toJson<String?>(category),
      'tableLabel': serializer.toJson<String?>(tableLabel),
      'allowance': serializer.toJson<int>(allowance),
      'admittedSynced': serializer.toJson<int>(admittedSynced),
      'rsvp': serializer.toJson<String>(rsvp),
      'searchTerms': serializer.toJson<String>(searchTerms),
    };
  }

  Invitation copyWith({
    String? passId,
    String? legId,
    String? displayName,
    Value<String?> category = const Value.absent(),
    Value<String?> tableLabel = const Value.absent(),
    int? allowance,
    int? admittedSynced,
    String? rsvp,
    String? searchTerms,
  }) => Invitation(
    passId: passId ?? this.passId,
    legId: legId ?? this.legId,
    displayName: displayName ?? this.displayName,
    category: category.present ? category.value : this.category,
    tableLabel: tableLabel.present ? tableLabel.value : this.tableLabel,
    allowance: allowance ?? this.allowance,
    admittedSynced: admittedSynced ?? this.admittedSynced,
    rsvp: rsvp ?? this.rsvp,
    searchTerms: searchTerms ?? this.searchTerms,
  );
  Invitation copyWithCompanion(InvitationsCompanion data) {
    return Invitation(
      passId: data.passId.present ? data.passId.value : this.passId,
      legId: data.legId.present ? data.legId.value : this.legId,
      displayName: data.displayName.present
          ? data.displayName.value
          : this.displayName,
      category: data.category.present ? data.category.value : this.category,
      tableLabel: data.tableLabel.present
          ? data.tableLabel.value
          : this.tableLabel,
      allowance: data.allowance.present ? data.allowance.value : this.allowance,
      admittedSynced: data.admittedSynced.present
          ? data.admittedSynced.value
          : this.admittedSynced,
      rsvp: data.rsvp.present ? data.rsvp.value : this.rsvp,
      searchTerms: data.searchTerms.present
          ? data.searchTerms.value
          : this.searchTerms,
    );
  }

  @override
  String toString() {
    return (StringBuffer('Invitation(')
          ..write('passId: $passId, ')
          ..write('legId: $legId, ')
          ..write('displayName: $displayName, ')
          ..write('category: $category, ')
          ..write('tableLabel: $tableLabel, ')
          ..write('allowance: $allowance, ')
          ..write('admittedSynced: $admittedSynced, ')
          ..write('rsvp: $rsvp, ')
          ..write('searchTerms: $searchTerms')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    passId,
    legId,
    displayName,
    category,
    tableLabel,
    allowance,
    admittedSynced,
    rsvp,
    searchTerms,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is Invitation &&
          other.passId == this.passId &&
          other.legId == this.legId &&
          other.displayName == this.displayName &&
          other.category == this.category &&
          other.tableLabel == this.tableLabel &&
          other.allowance == this.allowance &&
          other.admittedSynced == this.admittedSynced &&
          other.rsvp == this.rsvp &&
          other.searchTerms == this.searchTerms);
}

class InvitationsCompanion extends UpdateCompanion<Invitation> {
  final Value<String> passId;
  final Value<String> legId;
  final Value<String> displayName;
  final Value<String?> category;
  final Value<String?> tableLabel;
  final Value<int> allowance;
  final Value<int> admittedSynced;
  final Value<String> rsvp;
  final Value<String> searchTerms;
  final Value<int> rowid;
  const InvitationsCompanion({
    this.passId = const Value.absent(),
    this.legId = const Value.absent(),
    this.displayName = const Value.absent(),
    this.category = const Value.absent(),
    this.tableLabel = const Value.absent(),
    this.allowance = const Value.absent(),
    this.admittedSynced = const Value.absent(),
    this.rsvp = const Value.absent(),
    this.searchTerms = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  InvitationsCompanion.insert({
    required String passId,
    required String legId,
    required String displayName,
    this.category = const Value.absent(),
    this.tableLabel = const Value.absent(),
    required int allowance,
    required int admittedSynced,
    required String rsvp,
    required String searchTerms,
    this.rowid = const Value.absent(),
  }) : passId = Value(passId),
       legId = Value(legId),
       displayName = Value(displayName),
       allowance = Value(allowance),
       admittedSynced = Value(admittedSynced),
       rsvp = Value(rsvp),
       searchTerms = Value(searchTerms);
  static Insertable<Invitation> custom({
    Expression<String>? passId,
    Expression<String>? legId,
    Expression<String>? displayName,
    Expression<String>? category,
    Expression<String>? tableLabel,
    Expression<int>? allowance,
    Expression<int>? admittedSynced,
    Expression<String>? rsvp,
    Expression<String>? searchTerms,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (passId != null) 'pass_id': passId,
      if (legId != null) 'leg_id': legId,
      if (displayName != null) 'display_name': displayName,
      if (category != null) 'category': category,
      if (tableLabel != null) 'table_label': tableLabel,
      if (allowance != null) 'allowance': allowance,
      if (admittedSynced != null) 'admitted_synced': admittedSynced,
      if (rsvp != null) 'rsvp': rsvp,
      if (searchTerms != null) 'search_terms': searchTerms,
      if (rowid != null) 'rowid': rowid,
    });
  }

  InvitationsCompanion copyWith({
    Value<String>? passId,
    Value<String>? legId,
    Value<String>? displayName,
    Value<String?>? category,
    Value<String?>? tableLabel,
    Value<int>? allowance,
    Value<int>? admittedSynced,
    Value<String>? rsvp,
    Value<String>? searchTerms,
    Value<int>? rowid,
  }) {
    return InvitationsCompanion(
      passId: passId ?? this.passId,
      legId: legId ?? this.legId,
      displayName: displayName ?? this.displayName,
      category: category ?? this.category,
      tableLabel: tableLabel ?? this.tableLabel,
      allowance: allowance ?? this.allowance,
      admittedSynced: admittedSynced ?? this.admittedSynced,
      rsvp: rsvp ?? this.rsvp,
      searchTerms: searchTerms ?? this.searchTerms,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (passId.present) {
      map['pass_id'] = Variable<String>(passId.value);
    }
    if (legId.present) {
      map['leg_id'] = Variable<String>(legId.value);
    }
    if (displayName.present) {
      map['display_name'] = Variable<String>(displayName.value);
    }
    if (category.present) {
      map['category'] = Variable<String>(category.value);
    }
    if (tableLabel.present) {
      map['table_label'] = Variable<String>(tableLabel.value);
    }
    if (allowance.present) {
      map['allowance'] = Variable<int>(allowance.value);
    }
    if (admittedSynced.present) {
      map['admitted_synced'] = Variable<int>(admittedSynced.value);
    }
    if (rsvp.present) {
      map['rsvp'] = Variable<String>(rsvp.value);
    }
    if (searchTerms.present) {
      map['search_terms'] = Variable<String>(searchTerms.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('InvitationsCompanion(')
          ..write('passId: $passId, ')
          ..write('legId: $legId, ')
          ..write('displayName: $displayName, ')
          ..write('category: $category, ')
          ..write('tableLabel: $tableLabel, ')
          ..write('allowance: $allowance, ')
          ..write('admittedSynced: $admittedSynced, ')
          ..write('rsvp: $rsvp, ')
          ..write('searchTerms: $searchTerms, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $RevokedPassesTable extends RevokedPasses
    with TableInfo<$RevokedPassesTable, RevokedPassesData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $RevokedPassesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _passIdMeta = const VerificationMeta('passId');
  @override
  late final GeneratedColumn<String> passId = GeneratedColumn<String>(
    'pass_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _legIdMeta = const VerificationMeta('legId');
  @override
  late final GeneratedColumn<String> legId = GeneratedColumn<String>(
    'leg_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [passId, legId];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'revoked_passes';
  @override
  VerificationContext validateIntegrity(
    Insertable<RevokedPassesData> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('pass_id')) {
      context.handle(
        _passIdMeta,
        passId.isAcceptableOrUnknown(data['pass_id']!, _passIdMeta),
      );
    } else if (isInserting) {
      context.missing(_passIdMeta);
    }
    if (data.containsKey('leg_id')) {
      context.handle(
        _legIdMeta,
        legId.isAcceptableOrUnknown(data['leg_id']!, _legIdMeta),
      );
    } else if (isInserting) {
      context.missing(_legIdMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {passId, legId};
  @override
  RevokedPassesData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return RevokedPassesData(
      passId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}pass_id'],
      )!,
      legId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}leg_id'],
      )!,
    );
  }

  @override
  $RevokedPassesTable createAlias(String alias) {
    return $RevokedPassesTable(attachedDatabase, alias);
  }
}

class RevokedPassesData extends DataClass
    implements Insertable<RevokedPassesData> {
  final String passId;
  final String legId;
  const RevokedPassesData({required this.passId, required this.legId});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['pass_id'] = Variable<String>(passId);
    map['leg_id'] = Variable<String>(legId);
    return map;
  }

  RevokedPassesCompanion toCompanion(bool nullToAbsent) {
    return RevokedPassesCompanion(passId: Value(passId), legId: Value(legId));
  }

  factory RevokedPassesData.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return RevokedPassesData(
      passId: serializer.fromJson<String>(json['passId']),
      legId: serializer.fromJson<String>(json['legId']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'passId': serializer.toJson<String>(passId),
      'legId': serializer.toJson<String>(legId),
    };
  }

  RevokedPassesData copyWith({String? passId, String? legId}) =>
      RevokedPassesData(
        passId: passId ?? this.passId,
        legId: legId ?? this.legId,
      );
  RevokedPassesData copyWithCompanion(RevokedPassesCompanion data) {
    return RevokedPassesData(
      passId: data.passId.present ? data.passId.value : this.passId,
      legId: data.legId.present ? data.legId.value : this.legId,
    );
  }

  @override
  String toString() {
    return (StringBuffer('RevokedPassesData(')
          ..write('passId: $passId, ')
          ..write('legId: $legId')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(passId, legId);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is RevokedPassesData &&
          other.passId == this.passId &&
          other.legId == this.legId);
}

class RevokedPassesCompanion extends UpdateCompanion<RevokedPassesData> {
  final Value<String> passId;
  final Value<String> legId;
  final Value<int> rowid;
  const RevokedPassesCompanion({
    this.passId = const Value.absent(),
    this.legId = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  RevokedPassesCompanion.insert({
    required String passId,
    required String legId,
    this.rowid = const Value.absent(),
  }) : passId = Value(passId),
       legId = Value(legId);
  static Insertable<RevokedPassesData> custom({
    Expression<String>? passId,
    Expression<String>? legId,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (passId != null) 'pass_id': passId,
      if (legId != null) 'leg_id': legId,
      if (rowid != null) 'rowid': rowid,
    });
  }

  RevokedPassesCompanion copyWith({
    Value<String>? passId,
    Value<String>? legId,
    Value<int>? rowid,
  }) {
    return RevokedPassesCompanion(
      passId: passId ?? this.passId,
      legId: legId ?? this.legId,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (passId.present) {
      map['pass_id'] = Variable<String>(passId.value);
    }
    if (legId.present) {
      map['leg_id'] = Variable<String>(legId.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('RevokedPassesCompanion(')
          ..write('passId: $passId, ')
          ..write('legId: $legId, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $PendingScansTable extends PendingScans
    with TableInfo<$PendingScansTable, PendingScan> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $PendingScansTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _clientUuidMeta = const VerificationMeta(
    'clientUuid',
  );
  @override
  late final GeneratedColumn<String> clientUuid = GeneratedColumn<String>(
    'client_uuid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _legIdMeta = const VerificationMeta('legId');
  @override
  late final GeneratedColumn<String> legId = GeneratedColumn<String>(
    'leg_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _entranceIdMeta = const VerificationMeta(
    'entranceId',
  );
  @override
  late final GeneratedColumn<String> entranceId = GeneratedColumn<String>(
    'entrance_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _passIdMeta = const VerificationMeta('passId');
  @override
  late final GeneratedColumn<String> passId = GeneratedColumn<String>(
    'pass_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _resultMeta = const VerificationMeta('result');
  @override
  late final GeneratedColumn<String> result = GeneratedColumn<String>(
    'result',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _admittedCountMeta = const VerificationMeta(
    'admittedCount',
  );
  @override
  late final GeneratedColumn<int> admittedCount = GeneratedColumn<int>(
    'admitted_count',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _reversesClientUuidMeta =
      const VerificationMeta('reversesClientUuid');
  @override
  late final GeneratedColumn<String> reversesClientUuid =
      GeneratedColumn<String>(
        'reverses_client_uuid',
        aliasedName,
        true,
        type: DriftSqlType.string,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _scannedAtMeta = const VerificationMeta(
    'scannedAt',
  );
  @override
  late final GeneratedColumn<DateTime> scannedAt = GeneratedColumn<DateTime>(
    'scanned_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _noteMeta = const VerificationMeta('note');
  @override
  late final GeneratedColumn<String> note = GeneratedColumn<String>(
    'note',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _syncedMeta = const VerificationMeta('synced');
  @override
  late final GeneratedColumn<bool> synced = GeneratedColumn<bool>(
    'synced',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("synced" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _contestedMeta = const VerificationMeta(
    'contested',
  );
  @override
  late final GeneratedColumn<bool> contested = GeneratedColumn<bool>(
    'contested',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("contested" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _walkInNameMeta = const VerificationMeta(
    'walkInName',
  );
  @override
  late final GeneratedColumn<String> walkInName = GeneratedColumn<String>(
    'walk_in_name',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    clientUuid,
    legId,
    entranceId,
    passId,
    result,
    admittedCount,
    reversesClientUuid,
    scannedAt,
    note,
    synced,
    contested,
    walkInName,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'pending_scans';
  @override
  VerificationContext validateIntegrity(
    Insertable<PendingScan> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('client_uuid')) {
      context.handle(
        _clientUuidMeta,
        clientUuid.isAcceptableOrUnknown(data['client_uuid']!, _clientUuidMeta),
      );
    } else if (isInserting) {
      context.missing(_clientUuidMeta);
    }
    if (data.containsKey('leg_id')) {
      context.handle(
        _legIdMeta,
        legId.isAcceptableOrUnknown(data['leg_id']!, _legIdMeta),
      );
    } else if (isInserting) {
      context.missing(_legIdMeta);
    }
    if (data.containsKey('entrance_id')) {
      context.handle(
        _entranceIdMeta,
        entranceId.isAcceptableOrUnknown(data['entrance_id']!, _entranceIdMeta),
      );
    }
    if (data.containsKey('pass_id')) {
      context.handle(
        _passIdMeta,
        passId.isAcceptableOrUnknown(data['pass_id']!, _passIdMeta),
      );
    }
    if (data.containsKey('result')) {
      context.handle(
        _resultMeta,
        result.isAcceptableOrUnknown(data['result']!, _resultMeta),
      );
    } else if (isInserting) {
      context.missing(_resultMeta);
    }
    if (data.containsKey('admitted_count')) {
      context.handle(
        _admittedCountMeta,
        admittedCount.isAcceptableOrUnknown(
          data['admitted_count']!,
          _admittedCountMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_admittedCountMeta);
    }
    if (data.containsKey('reverses_client_uuid')) {
      context.handle(
        _reversesClientUuidMeta,
        reversesClientUuid.isAcceptableOrUnknown(
          data['reverses_client_uuid']!,
          _reversesClientUuidMeta,
        ),
      );
    }
    if (data.containsKey('scanned_at')) {
      context.handle(
        _scannedAtMeta,
        scannedAt.isAcceptableOrUnknown(data['scanned_at']!, _scannedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_scannedAtMeta);
    }
    if (data.containsKey('note')) {
      context.handle(
        _noteMeta,
        note.isAcceptableOrUnknown(data['note']!, _noteMeta),
      );
    }
    if (data.containsKey('synced')) {
      context.handle(
        _syncedMeta,
        synced.isAcceptableOrUnknown(data['synced']!, _syncedMeta),
      );
    }
    if (data.containsKey('contested')) {
      context.handle(
        _contestedMeta,
        contested.isAcceptableOrUnknown(data['contested']!, _contestedMeta),
      );
    }
    if (data.containsKey('walk_in_name')) {
      context.handle(
        _walkInNameMeta,
        walkInName.isAcceptableOrUnknown(
          data['walk_in_name']!,
          _walkInNameMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {clientUuid};
  @override
  PendingScan map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return PendingScan(
      clientUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}client_uuid'],
      )!,
      legId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}leg_id'],
      )!,
      entranceId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}entrance_id'],
      ),
      passId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}pass_id'],
      ),
      result: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}result'],
      )!,
      admittedCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}admitted_count'],
      )!,
      reversesClientUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}reverses_client_uuid'],
      ),
      scannedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}scanned_at'],
      )!,
      note: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}note'],
      ),
      synced: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}synced'],
      )!,
      contested: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}contested'],
      )!,
      walkInName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}walk_in_name'],
      ),
    );
  }

  @override
  $PendingScansTable createAlias(String alias) {
    return $PendingScansTable(attachedDatabase, alias);
  }
}

class PendingScan extends DataClass implements Insertable<PendingScan> {
  final String clientUuid;
  final String legId;
  final String? entranceId;
  final String? passId;
  final String result;
  final int admittedCount;
  final String? reversesClientUuid;
  final DateTime scannedAt;
  final String? note;
  final bool synced;
  final bool contested;

  /// Set when this row created a household rather than admitting one that
  /// was already invited. The name has to ride along: the server cannot
  /// know it, and the queue may not drain until hours later.
  final String? walkInName;
  const PendingScan({
    required this.clientUuid,
    required this.legId,
    this.entranceId,
    this.passId,
    required this.result,
    required this.admittedCount,
    this.reversesClientUuid,
    required this.scannedAt,
    this.note,
    required this.synced,
    required this.contested,
    this.walkInName,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['client_uuid'] = Variable<String>(clientUuid);
    map['leg_id'] = Variable<String>(legId);
    if (!nullToAbsent || entranceId != null) {
      map['entrance_id'] = Variable<String>(entranceId);
    }
    if (!nullToAbsent || passId != null) {
      map['pass_id'] = Variable<String>(passId);
    }
    map['result'] = Variable<String>(result);
    map['admitted_count'] = Variable<int>(admittedCount);
    if (!nullToAbsent || reversesClientUuid != null) {
      map['reverses_client_uuid'] = Variable<String>(reversesClientUuid);
    }
    map['scanned_at'] = Variable<DateTime>(scannedAt);
    if (!nullToAbsent || note != null) {
      map['note'] = Variable<String>(note);
    }
    map['synced'] = Variable<bool>(synced);
    map['contested'] = Variable<bool>(contested);
    if (!nullToAbsent || walkInName != null) {
      map['walk_in_name'] = Variable<String>(walkInName);
    }
    return map;
  }

  PendingScansCompanion toCompanion(bool nullToAbsent) {
    return PendingScansCompanion(
      clientUuid: Value(clientUuid),
      legId: Value(legId),
      entranceId: entranceId == null && nullToAbsent
          ? const Value.absent()
          : Value(entranceId),
      passId: passId == null && nullToAbsent
          ? const Value.absent()
          : Value(passId),
      result: Value(result),
      admittedCount: Value(admittedCount),
      reversesClientUuid: reversesClientUuid == null && nullToAbsent
          ? const Value.absent()
          : Value(reversesClientUuid),
      scannedAt: Value(scannedAt),
      note: note == null && nullToAbsent ? const Value.absent() : Value(note),
      synced: Value(synced),
      contested: Value(contested),
      walkInName: walkInName == null && nullToAbsent
          ? const Value.absent()
          : Value(walkInName),
    );
  }

  factory PendingScan.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return PendingScan(
      clientUuid: serializer.fromJson<String>(json['clientUuid']),
      legId: serializer.fromJson<String>(json['legId']),
      entranceId: serializer.fromJson<String?>(json['entranceId']),
      passId: serializer.fromJson<String?>(json['passId']),
      result: serializer.fromJson<String>(json['result']),
      admittedCount: serializer.fromJson<int>(json['admittedCount']),
      reversesClientUuid: serializer.fromJson<String?>(
        json['reversesClientUuid'],
      ),
      scannedAt: serializer.fromJson<DateTime>(json['scannedAt']),
      note: serializer.fromJson<String?>(json['note']),
      synced: serializer.fromJson<bool>(json['synced']),
      contested: serializer.fromJson<bool>(json['contested']),
      walkInName: serializer.fromJson<String?>(json['walkInName']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'clientUuid': serializer.toJson<String>(clientUuid),
      'legId': serializer.toJson<String>(legId),
      'entranceId': serializer.toJson<String?>(entranceId),
      'passId': serializer.toJson<String?>(passId),
      'result': serializer.toJson<String>(result),
      'admittedCount': serializer.toJson<int>(admittedCount),
      'reversesClientUuid': serializer.toJson<String?>(reversesClientUuid),
      'scannedAt': serializer.toJson<DateTime>(scannedAt),
      'note': serializer.toJson<String?>(note),
      'synced': serializer.toJson<bool>(synced),
      'contested': serializer.toJson<bool>(contested),
      'walkInName': serializer.toJson<String?>(walkInName),
    };
  }

  PendingScan copyWith({
    String? clientUuid,
    String? legId,
    Value<String?> entranceId = const Value.absent(),
    Value<String?> passId = const Value.absent(),
    String? result,
    int? admittedCount,
    Value<String?> reversesClientUuid = const Value.absent(),
    DateTime? scannedAt,
    Value<String?> note = const Value.absent(),
    bool? synced,
    bool? contested,
    Value<String?> walkInName = const Value.absent(),
  }) => PendingScan(
    clientUuid: clientUuid ?? this.clientUuid,
    legId: legId ?? this.legId,
    entranceId: entranceId.present ? entranceId.value : this.entranceId,
    passId: passId.present ? passId.value : this.passId,
    result: result ?? this.result,
    admittedCount: admittedCount ?? this.admittedCount,
    reversesClientUuid: reversesClientUuid.present
        ? reversesClientUuid.value
        : this.reversesClientUuid,
    scannedAt: scannedAt ?? this.scannedAt,
    note: note.present ? note.value : this.note,
    synced: synced ?? this.synced,
    contested: contested ?? this.contested,
    walkInName: walkInName.present ? walkInName.value : this.walkInName,
  );
  PendingScan copyWithCompanion(PendingScansCompanion data) {
    return PendingScan(
      clientUuid: data.clientUuid.present
          ? data.clientUuid.value
          : this.clientUuid,
      legId: data.legId.present ? data.legId.value : this.legId,
      entranceId: data.entranceId.present
          ? data.entranceId.value
          : this.entranceId,
      passId: data.passId.present ? data.passId.value : this.passId,
      result: data.result.present ? data.result.value : this.result,
      admittedCount: data.admittedCount.present
          ? data.admittedCount.value
          : this.admittedCount,
      reversesClientUuid: data.reversesClientUuid.present
          ? data.reversesClientUuid.value
          : this.reversesClientUuid,
      scannedAt: data.scannedAt.present ? data.scannedAt.value : this.scannedAt,
      note: data.note.present ? data.note.value : this.note,
      synced: data.synced.present ? data.synced.value : this.synced,
      contested: data.contested.present ? data.contested.value : this.contested,
      walkInName: data.walkInName.present
          ? data.walkInName.value
          : this.walkInName,
    );
  }

  @override
  String toString() {
    return (StringBuffer('PendingScan(')
          ..write('clientUuid: $clientUuid, ')
          ..write('legId: $legId, ')
          ..write('entranceId: $entranceId, ')
          ..write('passId: $passId, ')
          ..write('result: $result, ')
          ..write('admittedCount: $admittedCount, ')
          ..write('reversesClientUuid: $reversesClientUuid, ')
          ..write('scannedAt: $scannedAt, ')
          ..write('note: $note, ')
          ..write('synced: $synced, ')
          ..write('contested: $contested, ')
          ..write('walkInName: $walkInName')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    clientUuid,
    legId,
    entranceId,
    passId,
    result,
    admittedCount,
    reversesClientUuid,
    scannedAt,
    note,
    synced,
    contested,
    walkInName,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PendingScan &&
          other.clientUuid == this.clientUuid &&
          other.legId == this.legId &&
          other.entranceId == this.entranceId &&
          other.passId == this.passId &&
          other.result == this.result &&
          other.admittedCount == this.admittedCount &&
          other.reversesClientUuid == this.reversesClientUuid &&
          other.scannedAt == this.scannedAt &&
          other.note == this.note &&
          other.synced == this.synced &&
          other.contested == this.contested &&
          other.walkInName == this.walkInName);
}

class PendingScansCompanion extends UpdateCompanion<PendingScan> {
  final Value<String> clientUuid;
  final Value<String> legId;
  final Value<String?> entranceId;
  final Value<String?> passId;
  final Value<String> result;
  final Value<int> admittedCount;
  final Value<String?> reversesClientUuid;
  final Value<DateTime> scannedAt;
  final Value<String?> note;
  final Value<bool> synced;
  final Value<bool> contested;
  final Value<String?> walkInName;
  final Value<int> rowid;
  const PendingScansCompanion({
    this.clientUuid = const Value.absent(),
    this.legId = const Value.absent(),
    this.entranceId = const Value.absent(),
    this.passId = const Value.absent(),
    this.result = const Value.absent(),
    this.admittedCount = const Value.absent(),
    this.reversesClientUuid = const Value.absent(),
    this.scannedAt = const Value.absent(),
    this.note = const Value.absent(),
    this.synced = const Value.absent(),
    this.contested = const Value.absent(),
    this.walkInName = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  PendingScansCompanion.insert({
    required String clientUuid,
    required String legId,
    this.entranceId = const Value.absent(),
    this.passId = const Value.absent(),
    required String result,
    required int admittedCount,
    this.reversesClientUuid = const Value.absent(),
    required DateTime scannedAt,
    this.note = const Value.absent(),
    this.synced = const Value.absent(),
    this.contested = const Value.absent(),
    this.walkInName = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : clientUuid = Value(clientUuid),
       legId = Value(legId),
       result = Value(result),
       admittedCount = Value(admittedCount),
       scannedAt = Value(scannedAt);
  static Insertable<PendingScan> custom({
    Expression<String>? clientUuid,
    Expression<String>? legId,
    Expression<String>? entranceId,
    Expression<String>? passId,
    Expression<String>? result,
    Expression<int>? admittedCount,
    Expression<String>? reversesClientUuid,
    Expression<DateTime>? scannedAt,
    Expression<String>? note,
    Expression<bool>? synced,
    Expression<bool>? contested,
    Expression<String>? walkInName,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (clientUuid != null) 'client_uuid': clientUuid,
      if (legId != null) 'leg_id': legId,
      if (entranceId != null) 'entrance_id': entranceId,
      if (passId != null) 'pass_id': passId,
      if (result != null) 'result': result,
      if (admittedCount != null) 'admitted_count': admittedCount,
      if (reversesClientUuid != null)
        'reverses_client_uuid': reversesClientUuid,
      if (scannedAt != null) 'scanned_at': scannedAt,
      if (note != null) 'note': note,
      if (synced != null) 'synced': synced,
      if (contested != null) 'contested': contested,
      if (walkInName != null) 'walk_in_name': walkInName,
      if (rowid != null) 'rowid': rowid,
    });
  }

  PendingScansCompanion copyWith({
    Value<String>? clientUuid,
    Value<String>? legId,
    Value<String?>? entranceId,
    Value<String?>? passId,
    Value<String>? result,
    Value<int>? admittedCount,
    Value<String?>? reversesClientUuid,
    Value<DateTime>? scannedAt,
    Value<String?>? note,
    Value<bool>? synced,
    Value<bool>? contested,
    Value<String?>? walkInName,
    Value<int>? rowid,
  }) {
    return PendingScansCompanion(
      clientUuid: clientUuid ?? this.clientUuid,
      legId: legId ?? this.legId,
      entranceId: entranceId ?? this.entranceId,
      passId: passId ?? this.passId,
      result: result ?? this.result,
      admittedCount: admittedCount ?? this.admittedCount,
      reversesClientUuid: reversesClientUuid ?? this.reversesClientUuid,
      scannedAt: scannedAt ?? this.scannedAt,
      note: note ?? this.note,
      synced: synced ?? this.synced,
      contested: contested ?? this.contested,
      walkInName: walkInName ?? this.walkInName,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (clientUuid.present) {
      map['client_uuid'] = Variable<String>(clientUuid.value);
    }
    if (legId.present) {
      map['leg_id'] = Variable<String>(legId.value);
    }
    if (entranceId.present) {
      map['entrance_id'] = Variable<String>(entranceId.value);
    }
    if (passId.present) {
      map['pass_id'] = Variable<String>(passId.value);
    }
    if (result.present) {
      map['result'] = Variable<String>(result.value);
    }
    if (admittedCount.present) {
      map['admitted_count'] = Variable<int>(admittedCount.value);
    }
    if (reversesClientUuid.present) {
      map['reverses_client_uuid'] = Variable<String>(reversesClientUuid.value);
    }
    if (scannedAt.present) {
      map['scanned_at'] = Variable<DateTime>(scannedAt.value);
    }
    if (note.present) {
      map['note'] = Variable<String>(note.value);
    }
    if (synced.present) {
      map['synced'] = Variable<bool>(synced.value);
    }
    if (contested.present) {
      map['contested'] = Variable<bool>(contested.value);
    }
    if (walkInName.present) {
      map['walk_in_name'] = Variable<String>(walkInName.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('PendingScansCompanion(')
          ..write('clientUuid: $clientUuid, ')
          ..write('legId: $legId, ')
          ..write('entranceId: $entranceId, ')
          ..write('passId: $passId, ')
          ..write('result: $result, ')
          ..write('admittedCount: $admittedCount, ')
          ..write('reversesClientUuid: $reversesClientUuid, ')
          ..write('scannedAt: $scannedAt, ')
          ..write('note: $note, ')
          ..write('synced: $synced, ')
          ..write('contested: $contested, ')
          ..write('walkInName: $walkInName, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LegMetaTable extends LegMeta with TableInfo<$LegMetaTable, LegMetaData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LegMetaTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _legIdMeta = const VerificationMeta('legId');
  @override
  late final GeneratedColumn<String> legId = GeneratedColumn<String>(
    'leg_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _eventIdMeta = const VerificationMeta(
    'eventId',
  );
  @override
  late final GeneratedColumn<String> eventId = GeneratedColumn<String>(
    'event_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _eventNameMeta = const VerificationMeta(
    'eventName',
  );
  @override
  late final GeneratedColumn<String> eventName = GeneratedColumn<String>(
    'event_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _allowOverflowMeta = const VerificationMeta(
    'allowOverflow',
  );
  @override
  late final GeneratedColumn<bool> allowOverflow = GeneratedColumn<bool>(
    'allow_overflow',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("allow_overflow" IN (0, 1))',
    ),
  );
  static const VerificationMeta _requireRsvpMeta = const VerificationMeta(
    'requireRsvp',
  );
  @override
  late final GeneratedColumn<bool> requireRsvp = GeneratedColumn<bool>(
    'require_rsvp',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("require_rsvp" IN (0, 1))',
    ),
  );
  static const VerificationMeta _allowWalkinsMeta = const VerificationMeta(
    'allowWalkins',
  );
  @override
  late final GeneratedColumn<bool> allowWalkins = GeneratedColumn<bool>(
    'allow_walkins',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("allow_walkins" IN (0, 1))',
    ),
  );
  static const VerificationMeta _cancelledMeta = const VerificationMeta(
    'cancelled',
  );
  @override
  late final GeneratedColumn<bool> cancelled = GeneratedColumn<bool>(
    'cancelled',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("cancelled" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _managerPhoneMeta = const VerificationMeta(
    'managerPhone',
  );
  @override
  late final GeneratedColumn<String> managerPhone = GeneratedColumn<String>(
    'manager_phone',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _syncedAtMeta = const VerificationMeta(
    'syncedAt',
  );
  @override
  late final GeneratedColumn<DateTime> syncedAt = GeneratedColumn<DateTime>(
    'synced_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    legId,
    eventId,
    eventName,
    allowOverflow,
    requireRsvp,
    allowWalkins,
    cancelled,
    managerPhone,
    syncedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'leg_meta';
  @override
  VerificationContext validateIntegrity(
    Insertable<LegMetaData> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('leg_id')) {
      context.handle(
        _legIdMeta,
        legId.isAcceptableOrUnknown(data['leg_id']!, _legIdMeta),
      );
    } else if (isInserting) {
      context.missing(_legIdMeta);
    }
    if (data.containsKey('event_id')) {
      context.handle(
        _eventIdMeta,
        eventId.isAcceptableOrUnknown(data['event_id']!, _eventIdMeta),
      );
    } else if (isInserting) {
      context.missing(_eventIdMeta);
    }
    if (data.containsKey('event_name')) {
      context.handle(
        _eventNameMeta,
        eventName.isAcceptableOrUnknown(data['event_name']!, _eventNameMeta),
      );
    } else if (isInserting) {
      context.missing(_eventNameMeta);
    }
    if (data.containsKey('allow_overflow')) {
      context.handle(
        _allowOverflowMeta,
        allowOverflow.isAcceptableOrUnknown(
          data['allow_overflow']!,
          _allowOverflowMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_allowOverflowMeta);
    }
    if (data.containsKey('require_rsvp')) {
      context.handle(
        _requireRsvpMeta,
        requireRsvp.isAcceptableOrUnknown(
          data['require_rsvp']!,
          _requireRsvpMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_requireRsvpMeta);
    }
    if (data.containsKey('allow_walkins')) {
      context.handle(
        _allowWalkinsMeta,
        allowWalkins.isAcceptableOrUnknown(
          data['allow_walkins']!,
          _allowWalkinsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_allowWalkinsMeta);
    }
    if (data.containsKey('cancelled')) {
      context.handle(
        _cancelledMeta,
        cancelled.isAcceptableOrUnknown(data['cancelled']!, _cancelledMeta),
      );
    }
    if (data.containsKey('manager_phone')) {
      context.handle(
        _managerPhoneMeta,
        managerPhone.isAcceptableOrUnknown(
          data['manager_phone']!,
          _managerPhoneMeta,
        ),
      );
    }
    if (data.containsKey('synced_at')) {
      context.handle(
        _syncedAtMeta,
        syncedAt.isAcceptableOrUnknown(data['synced_at']!, _syncedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_syncedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {legId};
  @override
  LegMetaData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LegMetaData(
      legId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}leg_id'],
      )!,
      eventId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}event_id'],
      )!,
      eventName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}event_name'],
      )!,
      allowOverflow: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}allow_overflow'],
      )!,
      requireRsvp: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}require_rsvp'],
      )!,
      allowWalkins: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}allow_walkins'],
      )!,
      cancelled: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}cancelled'],
      )!,
      managerPhone: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}manager_phone'],
      ),
      syncedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}synced_at'],
      )!,
    );
  }

  @override
  $LegMetaTable createAlias(String alias) {
    return $LegMetaTable(attachedDatabase, alias);
  }
}

class LegMetaData extends DataClass implements Insertable<LegMetaData> {
  final String legId;
  final String eventId;
  final String eventName;
  final bool allowOverflow;
  final bool requireRsvp;
  final bool allowWalkins;

  /// The organiser called the event off. Carried in the offline payload
  /// because the gate has to refuse with no network too — the settings
  /// page promises the guest that passes stop working, not that they stop
  /// working when the scanner happens to have signal.
  final bool cancelled;

  /// Who "Call manager" dials. Carried offline for the same reason as
  /// everything else here: the moment an usher needs it is the moment the
  /// signal has gone.
  final String? managerPhone;
  final DateTime syncedAt;
  const LegMetaData({
    required this.legId,
    required this.eventId,
    required this.eventName,
    required this.allowOverflow,
    required this.requireRsvp,
    required this.allowWalkins,
    required this.cancelled,
    this.managerPhone,
    required this.syncedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['leg_id'] = Variable<String>(legId);
    map['event_id'] = Variable<String>(eventId);
    map['event_name'] = Variable<String>(eventName);
    map['allow_overflow'] = Variable<bool>(allowOverflow);
    map['require_rsvp'] = Variable<bool>(requireRsvp);
    map['allow_walkins'] = Variable<bool>(allowWalkins);
    map['cancelled'] = Variable<bool>(cancelled);
    if (!nullToAbsent || managerPhone != null) {
      map['manager_phone'] = Variable<String>(managerPhone);
    }
    map['synced_at'] = Variable<DateTime>(syncedAt);
    return map;
  }

  LegMetaCompanion toCompanion(bool nullToAbsent) {
    return LegMetaCompanion(
      legId: Value(legId),
      eventId: Value(eventId),
      eventName: Value(eventName),
      allowOverflow: Value(allowOverflow),
      requireRsvp: Value(requireRsvp),
      allowWalkins: Value(allowWalkins),
      cancelled: Value(cancelled),
      managerPhone: managerPhone == null && nullToAbsent
          ? const Value.absent()
          : Value(managerPhone),
      syncedAt: Value(syncedAt),
    );
  }

  factory LegMetaData.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LegMetaData(
      legId: serializer.fromJson<String>(json['legId']),
      eventId: serializer.fromJson<String>(json['eventId']),
      eventName: serializer.fromJson<String>(json['eventName']),
      allowOverflow: serializer.fromJson<bool>(json['allowOverflow']),
      requireRsvp: serializer.fromJson<bool>(json['requireRsvp']),
      allowWalkins: serializer.fromJson<bool>(json['allowWalkins']),
      cancelled: serializer.fromJson<bool>(json['cancelled']),
      managerPhone: serializer.fromJson<String?>(json['managerPhone']),
      syncedAt: serializer.fromJson<DateTime>(json['syncedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'legId': serializer.toJson<String>(legId),
      'eventId': serializer.toJson<String>(eventId),
      'eventName': serializer.toJson<String>(eventName),
      'allowOverflow': serializer.toJson<bool>(allowOverflow),
      'requireRsvp': serializer.toJson<bool>(requireRsvp),
      'allowWalkins': serializer.toJson<bool>(allowWalkins),
      'cancelled': serializer.toJson<bool>(cancelled),
      'managerPhone': serializer.toJson<String?>(managerPhone),
      'syncedAt': serializer.toJson<DateTime>(syncedAt),
    };
  }

  LegMetaData copyWith({
    String? legId,
    String? eventId,
    String? eventName,
    bool? allowOverflow,
    bool? requireRsvp,
    bool? allowWalkins,
    bool? cancelled,
    Value<String?> managerPhone = const Value.absent(),
    DateTime? syncedAt,
  }) => LegMetaData(
    legId: legId ?? this.legId,
    eventId: eventId ?? this.eventId,
    eventName: eventName ?? this.eventName,
    allowOverflow: allowOverflow ?? this.allowOverflow,
    requireRsvp: requireRsvp ?? this.requireRsvp,
    allowWalkins: allowWalkins ?? this.allowWalkins,
    cancelled: cancelled ?? this.cancelled,
    managerPhone: managerPhone.present ? managerPhone.value : this.managerPhone,
    syncedAt: syncedAt ?? this.syncedAt,
  );
  LegMetaData copyWithCompanion(LegMetaCompanion data) {
    return LegMetaData(
      legId: data.legId.present ? data.legId.value : this.legId,
      eventId: data.eventId.present ? data.eventId.value : this.eventId,
      eventName: data.eventName.present ? data.eventName.value : this.eventName,
      allowOverflow: data.allowOverflow.present
          ? data.allowOverflow.value
          : this.allowOverflow,
      requireRsvp: data.requireRsvp.present
          ? data.requireRsvp.value
          : this.requireRsvp,
      allowWalkins: data.allowWalkins.present
          ? data.allowWalkins.value
          : this.allowWalkins,
      cancelled: data.cancelled.present ? data.cancelled.value : this.cancelled,
      managerPhone: data.managerPhone.present
          ? data.managerPhone.value
          : this.managerPhone,
      syncedAt: data.syncedAt.present ? data.syncedAt.value : this.syncedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LegMetaData(')
          ..write('legId: $legId, ')
          ..write('eventId: $eventId, ')
          ..write('eventName: $eventName, ')
          ..write('allowOverflow: $allowOverflow, ')
          ..write('requireRsvp: $requireRsvp, ')
          ..write('allowWalkins: $allowWalkins, ')
          ..write('cancelled: $cancelled, ')
          ..write('managerPhone: $managerPhone, ')
          ..write('syncedAt: $syncedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    legId,
    eventId,
    eventName,
    allowOverflow,
    requireRsvp,
    allowWalkins,
    cancelled,
    managerPhone,
    syncedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LegMetaData &&
          other.legId == this.legId &&
          other.eventId == this.eventId &&
          other.eventName == this.eventName &&
          other.allowOverflow == this.allowOverflow &&
          other.requireRsvp == this.requireRsvp &&
          other.allowWalkins == this.allowWalkins &&
          other.cancelled == this.cancelled &&
          other.managerPhone == this.managerPhone &&
          other.syncedAt == this.syncedAt);
}

class LegMetaCompanion extends UpdateCompanion<LegMetaData> {
  final Value<String> legId;
  final Value<String> eventId;
  final Value<String> eventName;
  final Value<bool> allowOverflow;
  final Value<bool> requireRsvp;
  final Value<bool> allowWalkins;
  final Value<bool> cancelled;
  final Value<String?> managerPhone;
  final Value<DateTime> syncedAt;
  final Value<int> rowid;
  const LegMetaCompanion({
    this.legId = const Value.absent(),
    this.eventId = const Value.absent(),
    this.eventName = const Value.absent(),
    this.allowOverflow = const Value.absent(),
    this.requireRsvp = const Value.absent(),
    this.allowWalkins = const Value.absent(),
    this.cancelled = const Value.absent(),
    this.managerPhone = const Value.absent(),
    this.syncedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LegMetaCompanion.insert({
    required String legId,
    required String eventId,
    required String eventName,
    required bool allowOverflow,
    required bool requireRsvp,
    required bool allowWalkins,
    this.cancelled = const Value.absent(),
    this.managerPhone = const Value.absent(),
    required DateTime syncedAt,
    this.rowid = const Value.absent(),
  }) : legId = Value(legId),
       eventId = Value(eventId),
       eventName = Value(eventName),
       allowOverflow = Value(allowOverflow),
       requireRsvp = Value(requireRsvp),
       allowWalkins = Value(allowWalkins),
       syncedAt = Value(syncedAt);
  static Insertable<LegMetaData> custom({
    Expression<String>? legId,
    Expression<String>? eventId,
    Expression<String>? eventName,
    Expression<bool>? allowOverflow,
    Expression<bool>? requireRsvp,
    Expression<bool>? allowWalkins,
    Expression<bool>? cancelled,
    Expression<String>? managerPhone,
    Expression<DateTime>? syncedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (legId != null) 'leg_id': legId,
      if (eventId != null) 'event_id': eventId,
      if (eventName != null) 'event_name': eventName,
      if (allowOverflow != null) 'allow_overflow': allowOverflow,
      if (requireRsvp != null) 'require_rsvp': requireRsvp,
      if (allowWalkins != null) 'allow_walkins': allowWalkins,
      if (cancelled != null) 'cancelled': cancelled,
      if (managerPhone != null) 'manager_phone': managerPhone,
      if (syncedAt != null) 'synced_at': syncedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LegMetaCompanion copyWith({
    Value<String>? legId,
    Value<String>? eventId,
    Value<String>? eventName,
    Value<bool>? allowOverflow,
    Value<bool>? requireRsvp,
    Value<bool>? allowWalkins,
    Value<bool>? cancelled,
    Value<String?>? managerPhone,
    Value<DateTime>? syncedAt,
    Value<int>? rowid,
  }) {
    return LegMetaCompanion(
      legId: legId ?? this.legId,
      eventId: eventId ?? this.eventId,
      eventName: eventName ?? this.eventName,
      allowOverflow: allowOverflow ?? this.allowOverflow,
      requireRsvp: requireRsvp ?? this.requireRsvp,
      allowWalkins: allowWalkins ?? this.allowWalkins,
      cancelled: cancelled ?? this.cancelled,
      managerPhone: managerPhone ?? this.managerPhone,
      syncedAt: syncedAt ?? this.syncedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (legId.present) {
      map['leg_id'] = Variable<String>(legId.value);
    }
    if (eventId.present) {
      map['event_id'] = Variable<String>(eventId.value);
    }
    if (eventName.present) {
      map['event_name'] = Variable<String>(eventName.value);
    }
    if (allowOverflow.present) {
      map['allow_overflow'] = Variable<bool>(allowOverflow.value);
    }
    if (requireRsvp.present) {
      map['require_rsvp'] = Variable<bool>(requireRsvp.value);
    }
    if (allowWalkins.present) {
      map['allow_walkins'] = Variable<bool>(allowWalkins.value);
    }
    if (cancelled.present) {
      map['cancelled'] = Variable<bool>(cancelled.value);
    }
    if (managerPhone.present) {
      map['manager_phone'] = Variable<String>(managerPhone.value);
    }
    if (syncedAt.present) {
      map['synced_at'] = Variable<DateTime>(syncedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LegMetaCompanion(')
          ..write('legId: $legId, ')
          ..write('eventId: $eventId, ')
          ..write('eventName: $eventName, ')
          ..write('allowOverflow: $allowOverflow, ')
          ..write('requireRsvp: $requireRsvp, ')
          ..write('allowWalkins: $allowWalkins, ')
          ..write('cancelled: $cancelled, ')
          ..write('managerPhone: $managerPhone, ')
          ..write('syncedAt: $syncedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $SigningKeysTable extends SigningKeys
    with TableInfo<$SigningKeysTable, SigningKey> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SigningKeysTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _legIdMeta = const VerificationMeta('legId');
  @override
  late final GeneratedColumn<String> legId = GeneratedColumn<String>(
    'leg_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _eventIdMeta = const VerificationMeta(
    'eventId',
  );
  @override
  late final GeneratedColumn<String> eventId = GeneratedColumn<String>(
    'event_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _eventNameMeta = const VerificationMeta(
    'eventName',
  );
  @override
  late final GeneratedColumn<String> eventName = GeneratedColumn<String>(
    'event_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _tokenVersionMeta = const VerificationMeta(
    'tokenVersion',
  );
  @override
  late final GeneratedColumn<int> tokenVersion = GeneratedColumn<int>(
    'token_version',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _keyB64Meta = const VerificationMeta('keyB64');
  @override
  late final GeneratedColumn<String> keyB64 = GeneratedColumn<String>(
    'key_b64',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    legId,
    eventId,
    eventName,
    tokenVersion,
    keyB64,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'signing_keys';
  @override
  VerificationContext validateIntegrity(
    Insertable<SigningKey> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('leg_id')) {
      context.handle(
        _legIdMeta,
        legId.isAcceptableOrUnknown(data['leg_id']!, _legIdMeta),
      );
    } else if (isInserting) {
      context.missing(_legIdMeta);
    }
    if (data.containsKey('event_id')) {
      context.handle(
        _eventIdMeta,
        eventId.isAcceptableOrUnknown(data['event_id']!, _eventIdMeta),
      );
    } else if (isInserting) {
      context.missing(_eventIdMeta);
    }
    if (data.containsKey('event_name')) {
      context.handle(
        _eventNameMeta,
        eventName.isAcceptableOrUnknown(data['event_name']!, _eventNameMeta),
      );
    } else if (isInserting) {
      context.missing(_eventNameMeta);
    }
    if (data.containsKey('token_version')) {
      context.handle(
        _tokenVersionMeta,
        tokenVersion.isAcceptableOrUnknown(
          data['token_version']!,
          _tokenVersionMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_tokenVersionMeta);
    }
    if (data.containsKey('key_b64')) {
      context.handle(
        _keyB64Meta,
        keyB64.isAcceptableOrUnknown(data['key_b64']!, _keyB64Meta),
      );
    } else if (isInserting) {
      context.missing(_keyB64Meta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {legId, eventId, tokenVersion};
  @override
  SigningKey map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SigningKey(
      legId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}leg_id'],
      )!,
      eventId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}event_id'],
      )!,
      eventName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}event_name'],
      )!,
      tokenVersion: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}token_version'],
      )!,
      keyB64: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key_b64'],
      )!,
    );
  }

  @override
  $SigningKeysTable createAlias(String alias) {
    return $SigningKeysTable(attachedDatabase, alias);
  }
}

class SigningKey extends DataClass implements Insertable<SigningKey> {
  /// Whose bootstrap payload this key arrived in.
  final String legId;
  final String eventId;
  final String eventName;
  final int tokenVersion;

  /// base64 — the same encoding the API sends, decoded on load.
  final String keyB64;
  const SigningKey({
    required this.legId,
    required this.eventId,
    required this.eventName,
    required this.tokenVersion,
    required this.keyB64,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['leg_id'] = Variable<String>(legId);
    map['event_id'] = Variable<String>(eventId);
    map['event_name'] = Variable<String>(eventName);
    map['token_version'] = Variable<int>(tokenVersion);
    map['key_b64'] = Variable<String>(keyB64);
    return map;
  }

  SigningKeysCompanion toCompanion(bool nullToAbsent) {
    return SigningKeysCompanion(
      legId: Value(legId),
      eventId: Value(eventId),
      eventName: Value(eventName),
      tokenVersion: Value(tokenVersion),
      keyB64: Value(keyB64),
    );
  }

  factory SigningKey.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SigningKey(
      legId: serializer.fromJson<String>(json['legId']),
      eventId: serializer.fromJson<String>(json['eventId']),
      eventName: serializer.fromJson<String>(json['eventName']),
      tokenVersion: serializer.fromJson<int>(json['tokenVersion']),
      keyB64: serializer.fromJson<String>(json['keyB64']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'legId': serializer.toJson<String>(legId),
      'eventId': serializer.toJson<String>(eventId),
      'eventName': serializer.toJson<String>(eventName),
      'tokenVersion': serializer.toJson<int>(tokenVersion),
      'keyB64': serializer.toJson<String>(keyB64),
    };
  }

  SigningKey copyWith({
    String? legId,
    String? eventId,
    String? eventName,
    int? tokenVersion,
    String? keyB64,
  }) => SigningKey(
    legId: legId ?? this.legId,
    eventId: eventId ?? this.eventId,
    eventName: eventName ?? this.eventName,
    tokenVersion: tokenVersion ?? this.tokenVersion,
    keyB64: keyB64 ?? this.keyB64,
  );
  SigningKey copyWithCompanion(SigningKeysCompanion data) {
    return SigningKey(
      legId: data.legId.present ? data.legId.value : this.legId,
      eventId: data.eventId.present ? data.eventId.value : this.eventId,
      eventName: data.eventName.present ? data.eventName.value : this.eventName,
      tokenVersion: data.tokenVersion.present
          ? data.tokenVersion.value
          : this.tokenVersion,
      keyB64: data.keyB64.present ? data.keyB64.value : this.keyB64,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SigningKey(')
          ..write('legId: $legId, ')
          ..write('eventId: $eventId, ')
          ..write('eventName: $eventName, ')
          ..write('tokenVersion: $tokenVersion, ')
          ..write('keyB64: $keyB64')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(legId, eventId, eventName, tokenVersion, keyB64);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SigningKey &&
          other.legId == this.legId &&
          other.eventId == this.eventId &&
          other.eventName == this.eventName &&
          other.tokenVersion == this.tokenVersion &&
          other.keyB64 == this.keyB64);
}

class SigningKeysCompanion extends UpdateCompanion<SigningKey> {
  final Value<String> legId;
  final Value<String> eventId;
  final Value<String> eventName;
  final Value<int> tokenVersion;
  final Value<String> keyB64;
  final Value<int> rowid;
  const SigningKeysCompanion({
    this.legId = const Value.absent(),
    this.eventId = const Value.absent(),
    this.eventName = const Value.absent(),
    this.tokenVersion = const Value.absent(),
    this.keyB64 = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SigningKeysCompanion.insert({
    required String legId,
    required String eventId,
    required String eventName,
    required int tokenVersion,
    required String keyB64,
    this.rowid = const Value.absent(),
  }) : legId = Value(legId),
       eventId = Value(eventId),
       eventName = Value(eventName),
       tokenVersion = Value(tokenVersion),
       keyB64 = Value(keyB64);
  static Insertable<SigningKey> custom({
    Expression<String>? legId,
    Expression<String>? eventId,
    Expression<String>? eventName,
    Expression<int>? tokenVersion,
    Expression<String>? keyB64,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (legId != null) 'leg_id': legId,
      if (eventId != null) 'event_id': eventId,
      if (eventName != null) 'event_name': eventName,
      if (tokenVersion != null) 'token_version': tokenVersion,
      if (keyB64 != null) 'key_b64': keyB64,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SigningKeysCompanion copyWith({
    Value<String>? legId,
    Value<String>? eventId,
    Value<String>? eventName,
    Value<int>? tokenVersion,
    Value<String>? keyB64,
    Value<int>? rowid,
  }) {
    return SigningKeysCompanion(
      legId: legId ?? this.legId,
      eventId: eventId ?? this.eventId,
      eventName: eventName ?? this.eventName,
      tokenVersion: tokenVersion ?? this.tokenVersion,
      keyB64: keyB64 ?? this.keyB64,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (legId.present) {
      map['leg_id'] = Variable<String>(legId.value);
    }
    if (eventId.present) {
      map['event_id'] = Variable<String>(eventId.value);
    }
    if (eventName.present) {
      map['event_name'] = Variable<String>(eventName.value);
    }
    if (tokenVersion.present) {
      map['token_version'] = Variable<int>(tokenVersion.value);
    }
    if (keyB64.present) {
      map['key_b64'] = Variable<String>(keyB64.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SigningKeysCompanion(')
          ..write('legId: $legId, ')
          ..write('eventId: $eventId, ')
          ..write('eventName: $eventName, ')
          ..write('tokenVersion: $tokenVersion, ')
          ..write('keyB64: $keyB64, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $CachedAssignmentsTable extends CachedAssignments
    with TableInfo<$CachedAssignmentsTable, CachedAssignment> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedAssignmentsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _legIdMeta = const VerificationMeta('legId');
  @override
  late final GeneratedColumn<String> legId = GeneratedColumn<String>(
    'leg_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _payloadMeta = const VerificationMeta(
    'payload',
  );
  @override
  late final GeneratedColumn<String> payload = GeneratedColumn<String>(
    'payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _positionMeta = const VerificationMeta(
    'position',
  );
  @override
  late final GeneratedColumn<int> position = GeneratedColumn<int>(
    'position',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _fetchedAtMeta = const VerificationMeta(
    'fetchedAt',
  );
  @override
  late final GeneratedColumn<DateTime> fetchedAt = GeneratedColumn<DateTime>(
    'fetched_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [legId, payload, position, fetchedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_assignments';
  @override
  VerificationContext validateIntegrity(
    Insertable<CachedAssignment> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('leg_id')) {
      context.handle(
        _legIdMeta,
        legId.isAcceptableOrUnknown(data['leg_id']!, _legIdMeta),
      );
    } else if (isInserting) {
      context.missing(_legIdMeta);
    }
    if (data.containsKey('payload')) {
      context.handle(
        _payloadMeta,
        payload.isAcceptableOrUnknown(data['payload']!, _payloadMeta),
      );
    } else if (isInserting) {
      context.missing(_payloadMeta);
    }
    if (data.containsKey('position')) {
      context.handle(
        _positionMeta,
        position.isAcceptableOrUnknown(data['position']!, _positionMeta),
      );
    } else if (isInserting) {
      context.missing(_positionMeta);
    }
    if (data.containsKey('fetched_at')) {
      context.handle(
        _fetchedAtMeta,
        fetchedAt.isAcceptableOrUnknown(data['fetched_at']!, _fetchedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_fetchedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {legId};
  @override
  CachedAssignment map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedAssignment(
      legId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}leg_id'],
      )!,
      payload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload'],
      )!,
      position: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}position'],
      )!,
      fetchedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}fetched_at'],
      )!,
    );
  }

  @override
  $CachedAssignmentsTable createAlias(String alias) {
    return $CachedAssignmentsTable(attachedDatabase, alias);
  }
}

class CachedAssignment extends DataClass
    implements Insertable<CachedAssignment> {
  final String legId;

  /// The assignment object exactly as the API returned it.
  final String payload;
  final int position;
  final DateTime fetchedAt;
  const CachedAssignment({
    required this.legId,
    required this.payload,
    required this.position,
    required this.fetchedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['leg_id'] = Variable<String>(legId);
    map['payload'] = Variable<String>(payload);
    map['position'] = Variable<int>(position);
    map['fetched_at'] = Variable<DateTime>(fetchedAt);
    return map;
  }

  CachedAssignmentsCompanion toCompanion(bool nullToAbsent) {
    return CachedAssignmentsCompanion(
      legId: Value(legId),
      payload: Value(payload),
      position: Value(position),
      fetchedAt: Value(fetchedAt),
    );
  }

  factory CachedAssignment.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedAssignment(
      legId: serializer.fromJson<String>(json['legId']),
      payload: serializer.fromJson<String>(json['payload']),
      position: serializer.fromJson<int>(json['position']),
      fetchedAt: serializer.fromJson<DateTime>(json['fetchedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'legId': serializer.toJson<String>(legId),
      'payload': serializer.toJson<String>(payload),
      'position': serializer.toJson<int>(position),
      'fetchedAt': serializer.toJson<DateTime>(fetchedAt),
    };
  }

  CachedAssignment copyWith({
    String? legId,
    String? payload,
    int? position,
    DateTime? fetchedAt,
  }) => CachedAssignment(
    legId: legId ?? this.legId,
    payload: payload ?? this.payload,
    position: position ?? this.position,
    fetchedAt: fetchedAt ?? this.fetchedAt,
  );
  CachedAssignment copyWithCompanion(CachedAssignmentsCompanion data) {
    return CachedAssignment(
      legId: data.legId.present ? data.legId.value : this.legId,
      payload: data.payload.present ? data.payload.value : this.payload,
      position: data.position.present ? data.position.value : this.position,
      fetchedAt: data.fetchedAt.present ? data.fetchedAt.value : this.fetchedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedAssignment(')
          ..write('legId: $legId, ')
          ..write('payload: $payload, ')
          ..write('position: $position, ')
          ..write('fetchedAt: $fetchedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(legId, payload, position, fetchedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedAssignment &&
          other.legId == this.legId &&
          other.payload == this.payload &&
          other.position == this.position &&
          other.fetchedAt == this.fetchedAt);
}

class CachedAssignmentsCompanion extends UpdateCompanion<CachedAssignment> {
  final Value<String> legId;
  final Value<String> payload;
  final Value<int> position;
  final Value<DateTime> fetchedAt;
  final Value<int> rowid;
  const CachedAssignmentsCompanion({
    this.legId = const Value.absent(),
    this.payload = const Value.absent(),
    this.position = const Value.absent(),
    this.fetchedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedAssignmentsCompanion.insert({
    required String legId,
    required String payload,
    required int position,
    required DateTime fetchedAt,
    this.rowid = const Value.absent(),
  }) : legId = Value(legId),
       payload = Value(payload),
       position = Value(position),
       fetchedAt = Value(fetchedAt);
  static Insertable<CachedAssignment> custom({
    Expression<String>? legId,
    Expression<String>? payload,
    Expression<int>? position,
    Expression<DateTime>? fetchedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (legId != null) 'leg_id': legId,
      if (payload != null) 'payload': payload,
      if (position != null) 'position': position,
      if (fetchedAt != null) 'fetched_at': fetchedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedAssignmentsCompanion copyWith({
    Value<String>? legId,
    Value<String>? payload,
    Value<int>? position,
    Value<DateTime>? fetchedAt,
    Value<int>? rowid,
  }) {
    return CachedAssignmentsCompanion(
      legId: legId ?? this.legId,
      payload: payload ?? this.payload,
      position: position ?? this.position,
      fetchedAt: fetchedAt ?? this.fetchedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (legId.present) {
      map['leg_id'] = Variable<String>(legId.value);
    }
    if (payload.present) {
      map['payload'] = Variable<String>(payload.value);
    }
    if (position.present) {
      map['position'] = Variable<int>(position.value);
    }
    if (fetchedAt.present) {
      map['fetched_at'] = Variable<DateTime>(fetchedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedAssignmentsCompanion(')
          ..write('legId: $legId, ')
          ..write('payload: $payload, ')
          ..write('position: $position, ')
          ..write('fetchedAt: $fetchedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$ScannerDb extends GeneratedDatabase {
  _$ScannerDb(QueryExecutor e) : super(e);
  $ScannerDbManager get managers => $ScannerDbManager(this);
  late final $InvitationsTable invitations = $InvitationsTable(this);
  late final $RevokedPassesTable revokedPasses = $RevokedPassesTable(this);
  late final $PendingScansTable pendingScans = $PendingScansTable(this);
  late final $LegMetaTable legMeta = $LegMetaTable(this);
  late final $SigningKeysTable signingKeys = $SigningKeysTable(this);
  late final $CachedAssignmentsTable cachedAssignments =
      $CachedAssignmentsTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    invitations,
    revokedPasses,
    pendingScans,
    legMeta,
    signingKeys,
    cachedAssignments,
  ];
}

typedef $$InvitationsTableCreateCompanionBuilder =
    InvitationsCompanion Function({
      required String passId,
      required String legId,
      required String displayName,
      Value<String?> category,
      Value<String?> tableLabel,
      required int allowance,
      required int admittedSynced,
      required String rsvp,
      required String searchTerms,
      Value<int> rowid,
    });
typedef $$InvitationsTableUpdateCompanionBuilder =
    InvitationsCompanion Function({
      Value<String> passId,
      Value<String> legId,
      Value<String> displayName,
      Value<String?> category,
      Value<String?> tableLabel,
      Value<int> allowance,
      Value<int> admittedSynced,
      Value<String> rsvp,
      Value<String> searchTerms,
      Value<int> rowid,
    });

class $$InvitationsTableFilterComposer
    extends Composer<_$ScannerDb, $InvitationsTable> {
  $$InvitationsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get passId => $composableBuilder(
    column: $table.passId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get legId => $composableBuilder(
    column: $table.legId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get displayName => $composableBuilder(
    column: $table.displayName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get category => $composableBuilder(
    column: $table.category,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get tableLabel => $composableBuilder(
    column: $table.tableLabel,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get allowance => $composableBuilder(
    column: $table.allowance,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get admittedSynced => $composableBuilder(
    column: $table.admittedSynced,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get rsvp => $composableBuilder(
    column: $table.rsvp,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get searchTerms => $composableBuilder(
    column: $table.searchTerms,
    builder: (column) => ColumnFilters(column),
  );
}

class $$InvitationsTableOrderingComposer
    extends Composer<_$ScannerDb, $InvitationsTable> {
  $$InvitationsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get passId => $composableBuilder(
    column: $table.passId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get legId => $composableBuilder(
    column: $table.legId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get displayName => $composableBuilder(
    column: $table.displayName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get category => $composableBuilder(
    column: $table.category,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get tableLabel => $composableBuilder(
    column: $table.tableLabel,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get allowance => $composableBuilder(
    column: $table.allowance,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get admittedSynced => $composableBuilder(
    column: $table.admittedSynced,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get rsvp => $composableBuilder(
    column: $table.rsvp,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get searchTerms => $composableBuilder(
    column: $table.searchTerms,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$InvitationsTableAnnotationComposer
    extends Composer<_$ScannerDb, $InvitationsTable> {
  $$InvitationsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get passId =>
      $composableBuilder(column: $table.passId, builder: (column) => column);

  GeneratedColumn<String> get legId =>
      $composableBuilder(column: $table.legId, builder: (column) => column);

  GeneratedColumn<String> get displayName => $composableBuilder(
    column: $table.displayName,
    builder: (column) => column,
  );

  GeneratedColumn<String> get category =>
      $composableBuilder(column: $table.category, builder: (column) => column);

  GeneratedColumn<String> get tableLabel => $composableBuilder(
    column: $table.tableLabel,
    builder: (column) => column,
  );

  GeneratedColumn<int> get allowance =>
      $composableBuilder(column: $table.allowance, builder: (column) => column);

  GeneratedColumn<int> get admittedSynced => $composableBuilder(
    column: $table.admittedSynced,
    builder: (column) => column,
  );

  GeneratedColumn<String> get rsvp =>
      $composableBuilder(column: $table.rsvp, builder: (column) => column);

  GeneratedColumn<String> get searchTerms => $composableBuilder(
    column: $table.searchTerms,
    builder: (column) => column,
  );
}

class $$InvitationsTableTableManager
    extends
        RootTableManager<
          _$ScannerDb,
          $InvitationsTable,
          Invitation,
          $$InvitationsTableFilterComposer,
          $$InvitationsTableOrderingComposer,
          $$InvitationsTableAnnotationComposer,
          $$InvitationsTableCreateCompanionBuilder,
          $$InvitationsTableUpdateCompanionBuilder,
          (
            Invitation,
            BaseReferences<_$ScannerDb, $InvitationsTable, Invitation>,
          ),
          Invitation,
          PrefetchHooks Function()
        > {
  $$InvitationsTableTableManager(_$ScannerDb db, $InvitationsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$InvitationsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$InvitationsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$InvitationsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> passId = const Value.absent(),
                Value<String> legId = const Value.absent(),
                Value<String> displayName = const Value.absent(),
                Value<String?> category = const Value.absent(),
                Value<String?> tableLabel = const Value.absent(),
                Value<int> allowance = const Value.absent(),
                Value<int> admittedSynced = const Value.absent(),
                Value<String> rsvp = const Value.absent(),
                Value<String> searchTerms = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => InvitationsCompanion(
                passId: passId,
                legId: legId,
                displayName: displayName,
                category: category,
                tableLabel: tableLabel,
                allowance: allowance,
                admittedSynced: admittedSynced,
                rsvp: rsvp,
                searchTerms: searchTerms,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String passId,
                required String legId,
                required String displayName,
                Value<String?> category = const Value.absent(),
                Value<String?> tableLabel = const Value.absent(),
                required int allowance,
                required int admittedSynced,
                required String rsvp,
                required String searchTerms,
                Value<int> rowid = const Value.absent(),
              }) => InvitationsCompanion.insert(
                passId: passId,
                legId: legId,
                displayName: displayName,
                category: category,
                tableLabel: tableLabel,
                allowance: allowance,
                admittedSynced: admittedSynced,
                rsvp: rsvp,
                searchTerms: searchTerms,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$InvitationsTableProcessedTableManager =
    ProcessedTableManager<
      _$ScannerDb,
      $InvitationsTable,
      Invitation,
      $$InvitationsTableFilterComposer,
      $$InvitationsTableOrderingComposer,
      $$InvitationsTableAnnotationComposer,
      $$InvitationsTableCreateCompanionBuilder,
      $$InvitationsTableUpdateCompanionBuilder,
      (Invitation, BaseReferences<_$ScannerDb, $InvitationsTable, Invitation>),
      Invitation,
      PrefetchHooks Function()
    >;
typedef $$RevokedPassesTableCreateCompanionBuilder =
    RevokedPassesCompanion Function({
      required String passId,
      required String legId,
      Value<int> rowid,
    });
typedef $$RevokedPassesTableUpdateCompanionBuilder =
    RevokedPassesCompanion Function({
      Value<String> passId,
      Value<String> legId,
      Value<int> rowid,
    });

class $$RevokedPassesTableFilterComposer
    extends Composer<_$ScannerDb, $RevokedPassesTable> {
  $$RevokedPassesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get passId => $composableBuilder(
    column: $table.passId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get legId => $composableBuilder(
    column: $table.legId,
    builder: (column) => ColumnFilters(column),
  );
}

class $$RevokedPassesTableOrderingComposer
    extends Composer<_$ScannerDb, $RevokedPassesTable> {
  $$RevokedPassesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get passId => $composableBuilder(
    column: $table.passId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get legId => $composableBuilder(
    column: $table.legId,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$RevokedPassesTableAnnotationComposer
    extends Composer<_$ScannerDb, $RevokedPassesTable> {
  $$RevokedPassesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get passId =>
      $composableBuilder(column: $table.passId, builder: (column) => column);

  GeneratedColumn<String> get legId =>
      $composableBuilder(column: $table.legId, builder: (column) => column);
}

class $$RevokedPassesTableTableManager
    extends
        RootTableManager<
          _$ScannerDb,
          $RevokedPassesTable,
          RevokedPassesData,
          $$RevokedPassesTableFilterComposer,
          $$RevokedPassesTableOrderingComposer,
          $$RevokedPassesTableAnnotationComposer,
          $$RevokedPassesTableCreateCompanionBuilder,
          $$RevokedPassesTableUpdateCompanionBuilder,
          (
            RevokedPassesData,
            BaseReferences<_$ScannerDb, $RevokedPassesTable, RevokedPassesData>,
          ),
          RevokedPassesData,
          PrefetchHooks Function()
        > {
  $$RevokedPassesTableTableManager(_$ScannerDb db, $RevokedPassesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$RevokedPassesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$RevokedPassesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$RevokedPassesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> passId = const Value.absent(),
                Value<String> legId = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => RevokedPassesCompanion(
                passId: passId,
                legId: legId,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String passId,
                required String legId,
                Value<int> rowid = const Value.absent(),
              }) => RevokedPassesCompanion.insert(
                passId: passId,
                legId: legId,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$RevokedPassesTableProcessedTableManager =
    ProcessedTableManager<
      _$ScannerDb,
      $RevokedPassesTable,
      RevokedPassesData,
      $$RevokedPassesTableFilterComposer,
      $$RevokedPassesTableOrderingComposer,
      $$RevokedPassesTableAnnotationComposer,
      $$RevokedPassesTableCreateCompanionBuilder,
      $$RevokedPassesTableUpdateCompanionBuilder,
      (
        RevokedPassesData,
        BaseReferences<_$ScannerDb, $RevokedPassesTable, RevokedPassesData>,
      ),
      RevokedPassesData,
      PrefetchHooks Function()
    >;
typedef $$PendingScansTableCreateCompanionBuilder =
    PendingScansCompanion Function({
      required String clientUuid,
      required String legId,
      Value<String?> entranceId,
      Value<String?> passId,
      required String result,
      required int admittedCount,
      Value<String?> reversesClientUuid,
      required DateTime scannedAt,
      Value<String?> note,
      Value<bool> synced,
      Value<bool> contested,
      Value<String?> walkInName,
      Value<int> rowid,
    });
typedef $$PendingScansTableUpdateCompanionBuilder =
    PendingScansCompanion Function({
      Value<String> clientUuid,
      Value<String> legId,
      Value<String?> entranceId,
      Value<String?> passId,
      Value<String> result,
      Value<int> admittedCount,
      Value<String?> reversesClientUuid,
      Value<DateTime> scannedAt,
      Value<String?> note,
      Value<bool> synced,
      Value<bool> contested,
      Value<String?> walkInName,
      Value<int> rowid,
    });

class $$PendingScansTableFilterComposer
    extends Composer<_$ScannerDb, $PendingScansTable> {
  $$PendingScansTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get legId => $composableBuilder(
    column: $table.legId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get entranceId => $composableBuilder(
    column: $table.entranceId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get passId => $composableBuilder(
    column: $table.passId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get result => $composableBuilder(
    column: $table.result,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get admittedCount => $composableBuilder(
    column: $table.admittedCount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get reversesClientUuid => $composableBuilder(
    column: $table.reversesClientUuid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get scannedAt => $composableBuilder(
    column: $table.scannedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get note => $composableBuilder(
    column: $table.note,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get synced => $composableBuilder(
    column: $table.synced,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get contested => $composableBuilder(
    column: $table.contested,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get walkInName => $composableBuilder(
    column: $table.walkInName,
    builder: (column) => ColumnFilters(column),
  );
}

class $$PendingScansTableOrderingComposer
    extends Composer<_$ScannerDb, $PendingScansTable> {
  $$PendingScansTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get legId => $composableBuilder(
    column: $table.legId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get entranceId => $composableBuilder(
    column: $table.entranceId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get passId => $composableBuilder(
    column: $table.passId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get result => $composableBuilder(
    column: $table.result,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get admittedCount => $composableBuilder(
    column: $table.admittedCount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get reversesClientUuid => $composableBuilder(
    column: $table.reversesClientUuid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get scannedAt => $composableBuilder(
    column: $table.scannedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get note => $composableBuilder(
    column: $table.note,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get synced => $composableBuilder(
    column: $table.synced,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get contested => $composableBuilder(
    column: $table.contested,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get walkInName => $composableBuilder(
    column: $table.walkInName,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$PendingScansTableAnnotationComposer
    extends Composer<_$ScannerDb, $PendingScansTable> {
  $$PendingScansTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => column,
  );

  GeneratedColumn<String> get legId =>
      $composableBuilder(column: $table.legId, builder: (column) => column);

  GeneratedColumn<String> get entranceId => $composableBuilder(
    column: $table.entranceId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get passId =>
      $composableBuilder(column: $table.passId, builder: (column) => column);

  GeneratedColumn<String> get result =>
      $composableBuilder(column: $table.result, builder: (column) => column);

  GeneratedColumn<int> get admittedCount => $composableBuilder(
    column: $table.admittedCount,
    builder: (column) => column,
  );

  GeneratedColumn<String> get reversesClientUuid => $composableBuilder(
    column: $table.reversesClientUuid,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get scannedAt =>
      $composableBuilder(column: $table.scannedAt, builder: (column) => column);

  GeneratedColumn<String> get note =>
      $composableBuilder(column: $table.note, builder: (column) => column);

  GeneratedColumn<bool> get synced =>
      $composableBuilder(column: $table.synced, builder: (column) => column);

  GeneratedColumn<bool> get contested =>
      $composableBuilder(column: $table.contested, builder: (column) => column);

  GeneratedColumn<String> get walkInName => $composableBuilder(
    column: $table.walkInName,
    builder: (column) => column,
  );
}

class $$PendingScansTableTableManager
    extends
        RootTableManager<
          _$ScannerDb,
          $PendingScansTable,
          PendingScan,
          $$PendingScansTableFilterComposer,
          $$PendingScansTableOrderingComposer,
          $$PendingScansTableAnnotationComposer,
          $$PendingScansTableCreateCompanionBuilder,
          $$PendingScansTableUpdateCompanionBuilder,
          (
            PendingScan,
            BaseReferences<_$ScannerDb, $PendingScansTable, PendingScan>,
          ),
          PendingScan,
          PrefetchHooks Function()
        > {
  $$PendingScansTableTableManager(_$ScannerDb db, $PendingScansTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$PendingScansTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$PendingScansTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$PendingScansTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> clientUuid = const Value.absent(),
                Value<String> legId = const Value.absent(),
                Value<String?> entranceId = const Value.absent(),
                Value<String?> passId = const Value.absent(),
                Value<String> result = const Value.absent(),
                Value<int> admittedCount = const Value.absent(),
                Value<String?> reversesClientUuid = const Value.absent(),
                Value<DateTime> scannedAt = const Value.absent(),
                Value<String?> note = const Value.absent(),
                Value<bool> synced = const Value.absent(),
                Value<bool> contested = const Value.absent(),
                Value<String?> walkInName = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => PendingScansCompanion(
                clientUuid: clientUuid,
                legId: legId,
                entranceId: entranceId,
                passId: passId,
                result: result,
                admittedCount: admittedCount,
                reversesClientUuid: reversesClientUuid,
                scannedAt: scannedAt,
                note: note,
                synced: synced,
                contested: contested,
                walkInName: walkInName,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String clientUuid,
                required String legId,
                Value<String?> entranceId = const Value.absent(),
                Value<String?> passId = const Value.absent(),
                required String result,
                required int admittedCount,
                Value<String?> reversesClientUuid = const Value.absent(),
                required DateTime scannedAt,
                Value<String?> note = const Value.absent(),
                Value<bool> synced = const Value.absent(),
                Value<bool> contested = const Value.absent(),
                Value<String?> walkInName = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => PendingScansCompanion.insert(
                clientUuid: clientUuid,
                legId: legId,
                entranceId: entranceId,
                passId: passId,
                result: result,
                admittedCount: admittedCount,
                reversesClientUuid: reversesClientUuid,
                scannedAt: scannedAt,
                note: note,
                synced: synced,
                contested: contested,
                walkInName: walkInName,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$PendingScansTableProcessedTableManager =
    ProcessedTableManager<
      _$ScannerDb,
      $PendingScansTable,
      PendingScan,
      $$PendingScansTableFilterComposer,
      $$PendingScansTableOrderingComposer,
      $$PendingScansTableAnnotationComposer,
      $$PendingScansTableCreateCompanionBuilder,
      $$PendingScansTableUpdateCompanionBuilder,
      (
        PendingScan,
        BaseReferences<_$ScannerDb, $PendingScansTable, PendingScan>,
      ),
      PendingScan,
      PrefetchHooks Function()
    >;
typedef $$LegMetaTableCreateCompanionBuilder =
    LegMetaCompanion Function({
      required String legId,
      required String eventId,
      required String eventName,
      required bool allowOverflow,
      required bool requireRsvp,
      required bool allowWalkins,
      Value<bool> cancelled,
      Value<String?> managerPhone,
      required DateTime syncedAt,
      Value<int> rowid,
    });
typedef $$LegMetaTableUpdateCompanionBuilder =
    LegMetaCompanion Function({
      Value<String> legId,
      Value<String> eventId,
      Value<String> eventName,
      Value<bool> allowOverflow,
      Value<bool> requireRsvp,
      Value<bool> allowWalkins,
      Value<bool> cancelled,
      Value<String?> managerPhone,
      Value<DateTime> syncedAt,
      Value<int> rowid,
    });

class $$LegMetaTableFilterComposer
    extends Composer<_$ScannerDb, $LegMetaTable> {
  $$LegMetaTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get legId => $composableBuilder(
    column: $table.legId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get eventId => $composableBuilder(
    column: $table.eventId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get eventName => $composableBuilder(
    column: $table.eventName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get allowOverflow => $composableBuilder(
    column: $table.allowOverflow,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get requireRsvp => $composableBuilder(
    column: $table.requireRsvp,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get allowWalkins => $composableBuilder(
    column: $table.allowWalkins,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get cancelled => $composableBuilder(
    column: $table.cancelled,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get managerPhone => $composableBuilder(
    column: $table.managerPhone,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get syncedAt => $composableBuilder(
    column: $table.syncedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LegMetaTableOrderingComposer
    extends Composer<_$ScannerDb, $LegMetaTable> {
  $$LegMetaTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get legId => $composableBuilder(
    column: $table.legId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get eventId => $composableBuilder(
    column: $table.eventId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get eventName => $composableBuilder(
    column: $table.eventName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get allowOverflow => $composableBuilder(
    column: $table.allowOverflow,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get requireRsvp => $composableBuilder(
    column: $table.requireRsvp,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get allowWalkins => $composableBuilder(
    column: $table.allowWalkins,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get cancelled => $composableBuilder(
    column: $table.cancelled,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get managerPhone => $composableBuilder(
    column: $table.managerPhone,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get syncedAt => $composableBuilder(
    column: $table.syncedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LegMetaTableAnnotationComposer
    extends Composer<_$ScannerDb, $LegMetaTable> {
  $$LegMetaTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get legId =>
      $composableBuilder(column: $table.legId, builder: (column) => column);

  GeneratedColumn<String> get eventId =>
      $composableBuilder(column: $table.eventId, builder: (column) => column);

  GeneratedColumn<String> get eventName =>
      $composableBuilder(column: $table.eventName, builder: (column) => column);

  GeneratedColumn<bool> get allowOverflow => $composableBuilder(
    column: $table.allowOverflow,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get requireRsvp => $composableBuilder(
    column: $table.requireRsvp,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get allowWalkins => $composableBuilder(
    column: $table.allowWalkins,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get cancelled =>
      $composableBuilder(column: $table.cancelled, builder: (column) => column);

  GeneratedColumn<String> get managerPhone => $composableBuilder(
    column: $table.managerPhone,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get syncedAt =>
      $composableBuilder(column: $table.syncedAt, builder: (column) => column);
}

class $$LegMetaTableTableManager
    extends
        RootTableManager<
          _$ScannerDb,
          $LegMetaTable,
          LegMetaData,
          $$LegMetaTableFilterComposer,
          $$LegMetaTableOrderingComposer,
          $$LegMetaTableAnnotationComposer,
          $$LegMetaTableCreateCompanionBuilder,
          $$LegMetaTableUpdateCompanionBuilder,
          (
            LegMetaData,
            BaseReferences<_$ScannerDb, $LegMetaTable, LegMetaData>,
          ),
          LegMetaData,
          PrefetchHooks Function()
        > {
  $$LegMetaTableTableManager(_$ScannerDb db, $LegMetaTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LegMetaTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LegMetaTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LegMetaTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> legId = const Value.absent(),
                Value<String> eventId = const Value.absent(),
                Value<String> eventName = const Value.absent(),
                Value<bool> allowOverflow = const Value.absent(),
                Value<bool> requireRsvp = const Value.absent(),
                Value<bool> allowWalkins = const Value.absent(),
                Value<bool> cancelled = const Value.absent(),
                Value<String?> managerPhone = const Value.absent(),
                Value<DateTime> syncedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LegMetaCompanion(
                legId: legId,
                eventId: eventId,
                eventName: eventName,
                allowOverflow: allowOverflow,
                requireRsvp: requireRsvp,
                allowWalkins: allowWalkins,
                cancelled: cancelled,
                managerPhone: managerPhone,
                syncedAt: syncedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String legId,
                required String eventId,
                required String eventName,
                required bool allowOverflow,
                required bool requireRsvp,
                required bool allowWalkins,
                Value<bool> cancelled = const Value.absent(),
                Value<String?> managerPhone = const Value.absent(),
                required DateTime syncedAt,
                Value<int> rowid = const Value.absent(),
              }) => LegMetaCompanion.insert(
                legId: legId,
                eventId: eventId,
                eventName: eventName,
                allowOverflow: allowOverflow,
                requireRsvp: requireRsvp,
                allowWalkins: allowWalkins,
                cancelled: cancelled,
                managerPhone: managerPhone,
                syncedAt: syncedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LegMetaTableProcessedTableManager =
    ProcessedTableManager<
      _$ScannerDb,
      $LegMetaTable,
      LegMetaData,
      $$LegMetaTableFilterComposer,
      $$LegMetaTableOrderingComposer,
      $$LegMetaTableAnnotationComposer,
      $$LegMetaTableCreateCompanionBuilder,
      $$LegMetaTableUpdateCompanionBuilder,
      (LegMetaData, BaseReferences<_$ScannerDb, $LegMetaTable, LegMetaData>),
      LegMetaData,
      PrefetchHooks Function()
    >;
typedef $$SigningKeysTableCreateCompanionBuilder =
    SigningKeysCompanion Function({
      required String legId,
      required String eventId,
      required String eventName,
      required int tokenVersion,
      required String keyB64,
      Value<int> rowid,
    });
typedef $$SigningKeysTableUpdateCompanionBuilder =
    SigningKeysCompanion Function({
      Value<String> legId,
      Value<String> eventId,
      Value<String> eventName,
      Value<int> tokenVersion,
      Value<String> keyB64,
      Value<int> rowid,
    });

class $$SigningKeysTableFilterComposer
    extends Composer<_$ScannerDb, $SigningKeysTable> {
  $$SigningKeysTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get legId => $composableBuilder(
    column: $table.legId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get eventId => $composableBuilder(
    column: $table.eventId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get eventName => $composableBuilder(
    column: $table.eventName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get tokenVersion => $composableBuilder(
    column: $table.tokenVersion,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get keyB64 => $composableBuilder(
    column: $table.keyB64,
    builder: (column) => ColumnFilters(column),
  );
}

class $$SigningKeysTableOrderingComposer
    extends Composer<_$ScannerDb, $SigningKeysTable> {
  $$SigningKeysTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get legId => $composableBuilder(
    column: $table.legId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get eventId => $composableBuilder(
    column: $table.eventId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get eventName => $composableBuilder(
    column: $table.eventName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get tokenVersion => $composableBuilder(
    column: $table.tokenVersion,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get keyB64 => $composableBuilder(
    column: $table.keyB64,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$SigningKeysTableAnnotationComposer
    extends Composer<_$ScannerDb, $SigningKeysTable> {
  $$SigningKeysTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get legId =>
      $composableBuilder(column: $table.legId, builder: (column) => column);

  GeneratedColumn<String> get eventId =>
      $composableBuilder(column: $table.eventId, builder: (column) => column);

  GeneratedColumn<String> get eventName =>
      $composableBuilder(column: $table.eventName, builder: (column) => column);

  GeneratedColumn<int> get tokenVersion => $composableBuilder(
    column: $table.tokenVersion,
    builder: (column) => column,
  );

  GeneratedColumn<String> get keyB64 =>
      $composableBuilder(column: $table.keyB64, builder: (column) => column);
}

class $$SigningKeysTableTableManager
    extends
        RootTableManager<
          _$ScannerDb,
          $SigningKeysTable,
          SigningKey,
          $$SigningKeysTableFilterComposer,
          $$SigningKeysTableOrderingComposer,
          $$SigningKeysTableAnnotationComposer,
          $$SigningKeysTableCreateCompanionBuilder,
          $$SigningKeysTableUpdateCompanionBuilder,
          (
            SigningKey,
            BaseReferences<_$ScannerDb, $SigningKeysTable, SigningKey>,
          ),
          SigningKey,
          PrefetchHooks Function()
        > {
  $$SigningKeysTableTableManager(_$ScannerDb db, $SigningKeysTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SigningKeysTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SigningKeysTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SigningKeysTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> legId = const Value.absent(),
                Value<String> eventId = const Value.absent(),
                Value<String> eventName = const Value.absent(),
                Value<int> tokenVersion = const Value.absent(),
                Value<String> keyB64 = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SigningKeysCompanion(
                legId: legId,
                eventId: eventId,
                eventName: eventName,
                tokenVersion: tokenVersion,
                keyB64: keyB64,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String legId,
                required String eventId,
                required String eventName,
                required int tokenVersion,
                required String keyB64,
                Value<int> rowid = const Value.absent(),
              }) => SigningKeysCompanion.insert(
                legId: legId,
                eventId: eventId,
                eventName: eventName,
                tokenVersion: tokenVersion,
                keyB64: keyB64,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SigningKeysTableProcessedTableManager =
    ProcessedTableManager<
      _$ScannerDb,
      $SigningKeysTable,
      SigningKey,
      $$SigningKeysTableFilterComposer,
      $$SigningKeysTableOrderingComposer,
      $$SigningKeysTableAnnotationComposer,
      $$SigningKeysTableCreateCompanionBuilder,
      $$SigningKeysTableUpdateCompanionBuilder,
      (SigningKey, BaseReferences<_$ScannerDb, $SigningKeysTable, SigningKey>),
      SigningKey,
      PrefetchHooks Function()
    >;
typedef $$CachedAssignmentsTableCreateCompanionBuilder =
    CachedAssignmentsCompanion Function({
      required String legId,
      required String payload,
      required int position,
      required DateTime fetchedAt,
      Value<int> rowid,
    });
typedef $$CachedAssignmentsTableUpdateCompanionBuilder =
    CachedAssignmentsCompanion Function({
      Value<String> legId,
      Value<String> payload,
      Value<int> position,
      Value<DateTime> fetchedAt,
      Value<int> rowid,
    });

class $$CachedAssignmentsTableFilterComposer
    extends Composer<_$ScannerDb, $CachedAssignmentsTable> {
  $$CachedAssignmentsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get legId => $composableBuilder(
    column: $table.legId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get position => $composableBuilder(
    column: $table.position,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get fetchedAt => $composableBuilder(
    column: $table.fetchedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$CachedAssignmentsTableOrderingComposer
    extends Composer<_$ScannerDb, $CachedAssignmentsTable> {
  $$CachedAssignmentsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get legId => $composableBuilder(
    column: $table.legId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get position => $composableBuilder(
    column: $table.position,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get fetchedAt => $composableBuilder(
    column: $table.fetchedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$CachedAssignmentsTableAnnotationComposer
    extends Composer<_$ScannerDb, $CachedAssignmentsTable> {
  $$CachedAssignmentsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get legId =>
      $composableBuilder(column: $table.legId, builder: (column) => column);

  GeneratedColumn<String> get payload =>
      $composableBuilder(column: $table.payload, builder: (column) => column);

  GeneratedColumn<int> get position =>
      $composableBuilder(column: $table.position, builder: (column) => column);

  GeneratedColumn<DateTime> get fetchedAt =>
      $composableBuilder(column: $table.fetchedAt, builder: (column) => column);
}

class $$CachedAssignmentsTableTableManager
    extends
        RootTableManager<
          _$ScannerDb,
          $CachedAssignmentsTable,
          CachedAssignment,
          $$CachedAssignmentsTableFilterComposer,
          $$CachedAssignmentsTableOrderingComposer,
          $$CachedAssignmentsTableAnnotationComposer,
          $$CachedAssignmentsTableCreateCompanionBuilder,
          $$CachedAssignmentsTableUpdateCompanionBuilder,
          (
            CachedAssignment,
            BaseReferences<
              _$ScannerDb,
              $CachedAssignmentsTable,
              CachedAssignment
            >,
          ),
          CachedAssignment,
          PrefetchHooks Function()
        > {
  $$CachedAssignmentsTableTableManager(
    _$ScannerDb db,
    $CachedAssignmentsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedAssignmentsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedAssignmentsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedAssignmentsTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> legId = const Value.absent(),
                Value<String> payload = const Value.absent(),
                Value<int> position = const Value.absent(),
                Value<DateTime> fetchedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => CachedAssignmentsCompanion(
                legId: legId,
                payload: payload,
                position: position,
                fetchedAt: fetchedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String legId,
                required String payload,
                required int position,
                required DateTime fetchedAt,
                Value<int> rowid = const Value.absent(),
              }) => CachedAssignmentsCompanion.insert(
                legId: legId,
                payload: payload,
                position: position,
                fetchedAt: fetchedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$CachedAssignmentsTableProcessedTableManager =
    ProcessedTableManager<
      _$ScannerDb,
      $CachedAssignmentsTable,
      CachedAssignment,
      $$CachedAssignmentsTableFilterComposer,
      $$CachedAssignmentsTableOrderingComposer,
      $$CachedAssignmentsTableAnnotationComposer,
      $$CachedAssignmentsTableCreateCompanionBuilder,
      $$CachedAssignmentsTableUpdateCompanionBuilder,
      (
        CachedAssignment,
        BaseReferences<_$ScannerDb, $CachedAssignmentsTable, CachedAssignment>,
      ),
      CachedAssignment,
      PrefetchHooks Function()
    >;

class $ScannerDbManager {
  final _$ScannerDb _db;
  $ScannerDbManager(this._db);
  $$InvitationsTableTableManager get invitations =>
      $$InvitationsTableTableManager(_db, _db.invitations);
  $$RevokedPassesTableTableManager get revokedPasses =>
      $$RevokedPassesTableTableManager(_db, _db.revokedPasses);
  $$PendingScansTableTableManager get pendingScans =>
      $$PendingScansTableTableManager(_db, _db.pendingScans);
  $$LegMetaTableTableManager get legMeta =>
      $$LegMetaTableTableManager(_db, _db.legMeta);
  $$SigningKeysTableTableManager get signingKeys =>
      $$SigningKeysTableTableManager(_db, _db.signingKeys);
  $$CachedAssignmentsTableTableManager get cachedAssignments =>
      $$CachedAssignmentsTableTableManager(_db, _db.cachedAssignments);
}
