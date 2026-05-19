// mobile/lib/models/payment.dart
import 'package:flutter/material.dart';

enum PaymentMethod {
  wave('wave', 'Wave', Icons.waves),
  orangeMoney('orange_money', 'Orange Money', Icons.phone_android),
  card('card', 'Carte Bancaire', Icons.credit_card),
  cash('cash', 'Espèces', Icons.money);

  final String value;
  final String label;
  final IconData icon;
  const PaymentMethod(this.value, this.label, this.icon);

  static PaymentMethod fromString(String value) {
    return PaymentMethod.values.firstWhere(
      (e) => e.value == value,
      orElse: () => PaymentMethod.cash,
    );
  }
}

enum PaymentStatus {
  pending('pending', 'En attente', Colors.orange),
  processing('processing', 'En cours', Colors.blue),
  completed('completed', 'Payé', Colors.green),
  failed('failed', 'Échoué', Colors.red),
  refunded('refunded', 'Remboursé', Colors.purple);

  final String value;
  final String label;
  final Color color;
  const PaymentStatus(this.value, this.label, this.color);
}

class Payment {
  final String id;
  final String userId;
  final String? userName;
  final String? parcelId;
  final String? trackingNumber;
  final double amount;
  final PaymentMethod method;
  final PaymentStatus status;
  final String? transactionId;
  final String? phoneNumber;
  final String? reference;
  final String? description;
  final String? receiptUrl;
  final String? validatedBy;
  final DateTime? validatedAt;
  final DateTime createdAt;
  final DateTime? completedAt;
  final DateTime? updatedAt;

  Payment({
    required this.id,
    required this.userId,
    this.userName,
    this.parcelId,
    this.trackingNumber,
    required this.amount,
    required this.method,
    required this.status,
    this.transactionId,
    this.phoneNumber,
    this.reference,
    this.description,
    this.receiptUrl,
    this.validatedBy,
    this.validatedAt,
    required this.createdAt,
    this.completedAt,
    this.updatedAt,
  });

  factory Payment.fromJson(Map<String, dynamic> json) {
    DateTime? parseDateTime(dynamic value) {
      if (value == null) return null;
      try {
        return DateTime.parse(value.toString());
      } catch (e) {
        return null;
      }
    }

    return Payment(
      id: json['id']?.toString() ?? '',
      userId: json['userId']?.toString() ?? '',
      userName: json['userName']?.toString(),
      parcelId: json['parcelId']?.toString(),
      trackingNumber: json['trackingNumber']?.toString(),
      amount: (json['amount'] ?? 0).toDouble(),
      method: json['method'] != null ? PaymentMethod.fromString(json['method'].toString()) : PaymentMethod.cash,
      status: json['status'] != null 
          ? PaymentStatus.values.firstWhere(
              (e) => e.value == json['status'].toString(),
              orElse: () => PaymentStatus.pending,
            )
          : PaymentStatus.pending,
      transactionId: json['transactionId']?.toString(),
      phoneNumber: json['phoneNumber']?.toString(),
      reference: json['reference']?.toString(),
      description: json['description']?.toString(),
      receiptUrl: json['receiptUrl']?.toString(),
      validatedBy: json['validatedBy']?.toString(),
      validatedAt: parseDateTime(json['validatedAt']),
      createdAt: parseDateTime(json['createdAt']) ?? DateTime.now(),
      completedAt: parseDateTime(json['completedAt']),
      updatedAt: parseDateTime(json['updatedAt']),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'userId': userId,
    'userName': userName,
    'parcelId': parcelId,
    'trackingNumber': trackingNumber,
    'amount': amount,
    'method': method.value,
    'status': status.value,
    'transactionId': transactionId,
    'phoneNumber': phoneNumber,
    'reference': reference,
    'description': description,
    'receiptUrl': receiptUrl,
    'validatedBy': validatedBy,
    'validatedAt': validatedAt?.toIso8601String(),
    'createdAt': createdAt.toIso8601String(),
    'completedAt': completedAt?.toIso8601String(),
    'updatedAt': updatedAt?.toIso8601String(),
  };

  bool get isCompleted => status == PaymentStatus.completed;
  bool get isPending => status == PaymentStatus.pending;
  bool get isFailed => status == PaymentStatus.failed;
  bool get isRefunded => status == PaymentStatus.refunded;

  String get formattedAmount => '${amount.toStringAsFixed(0)} FCFA';

  Payment copyWith({
    String? id,
    String? userId,
    String? userName,
    String? parcelId,
    String? trackingNumber,
    double? amount,
    PaymentMethod? method,
    PaymentStatus? status,
    String? transactionId,
    String? phoneNumber,
    String? reference,
    String? description,
    String? receiptUrl,
    String? validatedBy,
    DateTime? validatedAt,
    DateTime? createdAt,
    DateTime? completedAt,
    DateTime? updatedAt,
  }) {
    return Payment(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      userName: userName ?? this.userName,
      parcelId: parcelId ?? this.parcelId,
      trackingNumber: trackingNumber ?? this.trackingNumber,
      amount: amount ?? this.amount,
      method: method ?? this.method,
      status: status ?? this.status,
      transactionId: transactionId ?? this.transactionId,
      phoneNumber: phoneNumber ?? this.phoneNumber,
      reference: reference ?? this.reference,
      description: description ?? this.description,
      receiptUrl: receiptUrl ?? this.receiptUrl,
      validatedBy: validatedBy ?? this.validatedBy,
      validatedAt: validatedAt ?? this.validatedAt,
      createdAt: createdAt ?? this.createdAt,
      completedAt: completedAt ?? this.completedAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}