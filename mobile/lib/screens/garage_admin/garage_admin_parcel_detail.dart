// mobile/lib/screens/garage_admin/garage_admin_parcel_detail.dart
import 'package:flutter/material.dart';

import '../../models/parcel.dart';
import '../../services/api_service.dart';

class GarageAdminParcelDetailScreen extends StatefulWidget {
  final Parcel parcel;

  const GarageAdminParcelDetailScreen({super.key, required this.parcel});

  @override
  State<GarageAdminParcelDetailScreen> createState() => _GarageAdminParcelDetailScreenState();
}

class _GarageAdminParcelDetailScreenState extends State<GarageAdminParcelDetailScreen> {
  final ApiService _apiService = ApiService();
  bool _isUpdating = false;

  Future<void> _updateStatus(String newStatus) async {
    setState(() => _isUpdating = true);
    try {
      final Parcel updatedParcel = await _apiService.updateParcelStatus(widget.parcel.id, newStatus);
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Statut mis à jour avec succès'), backgroundColor: Colors.green),
        );
        // Return the updated parcel to the previous screen
        Navigator.pop(context, updatedParcel);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isUpdating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.parcel.trackingNumber),
        backgroundColor: const Color(0xFF0B6E3A),
        foregroundColor: Colors.white,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            _buildInfoCard(),
            const SizedBox(height: 16),
            _buildStatusCard(),
            if (widget.parcel.status == ParcelStatus.pending) ...[
              const SizedBox(height: 16),
              _buildActionsCard(),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildInfoCard() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Informations du colis', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            _buildInfoRow(label: 'Numéro de suivi', value: widget.parcel.trackingNumber),
            _buildInfoRow(label: 'Expéditeur', value: widget.parcel.senderName),
            _buildInfoRow(label: 'Destinataire', value: widget.parcel.receiverName),
            _buildInfoRow(label: 'Téléphone', value: widget.parcel.receiverPhone),
            _buildInfoRow(label: 'Description', value: widget.parcel.description),
            _buildInfoRow(label: 'Poids', value: '${widget.parcel.weight} kg'),
            _buildInfoRow(label: 'Type', value: widget.parcel.type.label),
            if (widget.parcel.price != null)
              _buildInfoRow(label: 'Prix', value: '${widget.parcel.price!.toInt()} FCFA'),
            _buildInfoRow(label: 'Départ', value: widget.parcel.departureGarageName),
            if (widget.parcel.arrivalGarageName != null)
              _buildInfoRow(label: 'Arrivée', value: widget.parcel.arrivalGarageName!),
            _buildInfoRow(label: 'Créé le', value: _formatDate(widget.parcel.createdAt)),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusCard() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Statut actuel', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: widget.parcel.status.color.withAlpha(25),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Icon(widget.parcel.status == ParcelStatus.delivered ? Icons.check_circle : Icons.pending,
                      color: widget.parcel.status.color, size: 32),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(widget.parcel.status.label, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: widget.parcel.status.color)),
                        if (widget.parcel.driverName != null)
                          Text('Chauffeur: ${widget.parcel.driverName}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                        if (widget.parcel.deliveryDate != null)
                          Text('Livré le: ${_formatDate(widget.parcel.deliveryDate!)}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActionsCard() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Actions', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            if (widget.parcel.status == ParcelStatus.pending)
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _isUpdating ? null : () => _updateStatus('confirmed'),
                  icon: const Icon(Icons.check_circle),
                  label: const Text('Confirmer le colis'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.blue),
                ),
              ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _isUpdating ? null : () => _updateStatus('cancelled'),
                icon: const Icon(Icons.cancel),
                label: const Text('Annuler le colis'),
                style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow({required String label, required String value}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(label, style: const TextStyle(color: Colors.grey, fontSize: 13)),
          ),
          Expanded(child: Text(value, style: const TextStyle(fontSize: 13))),
        ],
      ),
    );
  }

  String _formatDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year} à ${date.hour}:${date.minute.toString().padLeft(2, '0')}';
  }
}